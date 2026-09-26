// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `BITMAPCONV_INFO` against the files KiCad 10.0.5's own `bitmap2component`
 * wrote (`qa/data/bitmap2component/`, see its README for how they were made).
 *
 * The comparison is the whole file, byte for byte, with two substitutions
 * that are policy, not tolerance: every `(uuid ...)` is a fresh `KIID()` on
 * both sides, and the generator names us (`common/generator.ts`).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GENERATOR, GENERATOR_VERSION } from '@ziroeda/common/generator.js';
import { Reporter, RPT_SEVERITY_ERROR } from '@ziroeda/common/reporter.js';
import { BM_PUT, bm_new, type potrace_bitmap_t } from '@ziroeda/potrace';
import {
  BITMAPCONV_INFO,
  BezierToPolyline,
  DRAWING_SHEET_FMT,
  FOOTPRINT_FMT,
  OUTPUT_FMT_ID,
  POSTSCRIPT_FMT,
  SYMBOL_FMT,
  SYMBOL_PASTE_FMT,
} from '@ziroeda/bitmap2component';

const fixture = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../../data/bitmap2component/${name}`, import.meta.url)),
    'utf8',
  );

/** A bitmap with `black(x, y)` set, filled the way ExportToBuffer fills it. */
function bitmap(w: number, h: number, black: (x: number, y: number) => boolean): potrace_bitmap_t {
  const bm = bm_new(w, h)!;

  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) BM_PUT(bm, x, y, black(x, y) ? 1 : 0);

  return bm;
}

const square24 = (): potrace_bitmap_t =>
  bitmap(24, 24, (x, y) => x >= 6 && x < 18 && y >= 6 && y < 18);
const ring30 = (): potrace_bitmap_t =>
  bitmap(
    30,
    30,
    (x, y) => x >= 4 && x < 26 && y >= 4 && y < 26 && !(x >= 11 && x < 19 && y >= 11 && y < 19),
  );
const twoblob = (): potrace_bitmap_t =>
  bitmap(40, 20, (x, y) => ((x >= 4 && x < 12) || (x >= 28 && x < 36)) && y >= 5 && y < 15);
const blank10 = (): potrace_bitmap_t => bitmap(10, 10, () => false);

function convert(
  bm: potrace_bitmap_t,
  fmt: OUTPUT_FMT_ID,
  dpiX: number,
  dpiY: number,
  layer = 'F.SilkS',
  reporter = new Reporter(),
): string {
  const out = { value: '' };
  expect(new BITMAPCONV_INFO(out, reporter).ConvertBitmap(bm, fmt, dpiX, dpiY, layer)).toBe(0);
  return out.value;
}

const UUID = /\(uuid [0-9a-f-]{36}\)/g;

/** KiCad's file with its uuids blanked and its generator swapped for ours. */
const expected = (name: string): string =>
  fixture(name)
    .replace(UUID, '(uuid *)')
    .replace(
      '(generator "bitmap2component") (generator_version "10.0")',
      `(generator "${GENERATOR}") (generator_version "${GENERATOR_VERSION}")`,
    );

const ours = (text: string): string => text.replace(UUID, '(uuid *)');

describe("BITMAPCONV_INFO writes KiCad's own bytes", () => {
  it('footprint, 24 px square at 300 DPI', () => {
    expect(ours(convert(square24(), FOOTPRINT_FMT, 300, 300, 'F.Cu'))).toBe(
      expected('kicad_square24_300dpi.kicad_mod'),
    );
  });

  it('footprint, the same square at 2.1 mm, i.e. 290 DPI', () => {
    expect(ours(convert(square24(), FOOTPRINT_FMT, 290, 290, 'F.Cu'))).toBe(
      expected('kicad_square24_2.1mm.kicad_mod'),
    );
  });

  it('footprint, a ring: one fractured outline, on the chosen layer', () => {
    expect(ours(convert(ring30(), FOOTPRINT_FMT, 300, 300, 'F.Cu'))).toBe(
      expected('kicad_ring30_300dpi.kicad_mod'),
    );
  });

  it('symbol library, 24 px square', () => {
    expect(convert(square24(), SYMBOL_FMT, 300, 300)).toBe(
      expected('kicad_square24_300dpi.kicad_sym'),
    );
  });

  it('drawing sheet, two blobs: one polygon item, a (pts) per blob', () => {
    expect(convert(twoblob(), DRAWING_SHEET_FMT, 300, 300)).toBe(
      expected('kicad_twoblob_300dpi.kicad_wks'),
    );
  });

  it('PostScript, two blobs', () => {
    expect(convert(twoblob(), POSTSCRIPT_FMT, 300, 300)).toBe(fixture('kicad_twoblob_300dpi.ps'));
  });

  it('a blank bitmap reports "no outline" and still writes the header and the end', () => {
    const reporter = new Reporter();
    expect(ours(convert(blank10(), FOOTPRINT_FMT, 300, 300, 'F.SilkS', reporter))).toBe(
      expected('kicad_blank10_300dpi.kicad_mod'),
    );
    expect(reporter.lines).toEqual([
      {
        message: 'No shape in black and white image to convert: no outline created.',
        severity: RPT_SEVERITY_ERROR,
        location: 'body',
      },
    ]);
  });

  it('the footprint header puts both texts on F.SilkS whatever the outline layer', () => {
    const text = convert(square24(), FOOTPRINT_FMT, 300, 300, 'Eco2.User');
    expect(text.match(/\(layer "[^"]+"\)/g)).toEqual([
      '(layer "F.Cu")',
      '(layer "F.SilkS")',
      '(layer "F.SilkS")',
      '(layer "Eco2.User")',
    ]);
  });
});

describe('PostScript line wrapping (outputOnePolygon)', () => {
  it('breaks after every eighth lineto: `if( jj++ > 6 )` from jj = 0', () => {
    // A disc traces to one long outline; the two-blob file above never wraps.
    const disc = bitmap(24, 24, (x, y) => (x + 0.5 - 12) ** 2 + (y + 0.5 - 12) ** 2 <= 90);
    const text = convert(disc, POSTSCRIPT_FMT, 300, 300);
    const body = text.split('moveto\n')[1]!.split('\nclosepath fill')[0]!;
    const counts = body.split('\n').map((line) => line.match(/lineto/g)?.length ?? 0);
    expect(counts.length).toBeGreaterThan(2);
    expect(counts.slice(0, -1).every((n) => n === 8)).toBe(true);
    expect(counts.at(-1)).toBeLessThanOrEqual(8);
  });
});

describe('SYMBOL_PASTE_FMT is SYMBOL_FMT without the library wrapper', () => {
  it('drops the (kicad_symbol_lib ...) line and its closing paren, nothing else', () => {
    const lib = convert(square24(), SYMBOL_FMT, 300, 300);
    const paste = convert(square24(), SYMBOL_PASTE_FMT, 300, 300);
    const libLines = lib.split('\n');
    expect(paste).toBe(`${libLines.slice(1, -2).join('\n')}\n`);
    expect(libLines.at(-2)).toBe(')');
  });
});

describe('BezierToPolyline (bitmap2component.cpp)', () => {
  it('samples at a fixed epsilon = sqrt(8 delta / dd), delta 0.25 px, and ends on p4', () => {
    // p1..p4 = (0,0) (0,6) (6,6) (6,0): dd0 = |p1 - 2p2 + p3|^2 = 36 + 36 = 72,
    // dd1 = |p2 - 2p3 + p4|^2 = 72, dd = 6 sqrt(72) = 50.9117, e2 = 2 / dd,
    // epsilon = sqrt(2 / 50.9117) = 0.198201: t = eps .. 5 eps (< 1), then p4.
    const out: { x: number; y: number }[] = [];
    BezierToPolyline(out, { x: 0, y: 0 }, { x: 0, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 0 });
    expect(out).toHaveLength(6);
    const eps = Math.sqrt(2 / (6 * Math.sqrt(72)));
    expect(eps).toBeCloseTo(0.198201, 6);
    // t = eps: x = 3*6*(1-t)t^2 + 6t^3, y = 3*6*(1-t)^2 t + 3*6*(1-t)t^2
    const t = eps;
    expect(out[0]!.x).toBeCloseTo(18 * (1 - t) * t * t + 6 * t * t * t, 12);
    expect(out[0]!.y).toBeCloseTo(18 * (1 - t) * (1 - t) * t + 18 * (1 - t) * t * t, 12);
    expect(out[5]).toEqual({ x: 6, y: 0 });
  });

  it('a curve flat enough for dd < 8 delta gets e2 = 1: only p4', () => {
    const out: { x: number; y: number }[] = [];
    BezierToPolyline(out, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 });
    expect(out).toEqual([{ x: 3, y: 0 }]);
  });
});

interface PolyOracle {
  name: string;
  dpi: number;
  polygons: number[][][];
}

const traced: { name: string; rows: string[] }[] = JSON.parse(fixture('potrace_oracle.json'));
const polyOracle: PolyOracle[] = JSON.parse(fixture('poly_oracle.json'));

describe("createOutputData with curves and holes, against KiCad's SHAPE_POLY_SET", () => {
  /*
   * poly_oracle.json is qa/probes/bitmap2component_poly_oracle.py: KiCad's own
   * potracelib paths fed through KiCad's own SHAPE_POLY_SET (the installed
   * pcbnew Python module) the way createOutputData calls it. Each expected
   * point is an fp_poly vertex in IU relative to the footprint offset, so the
   * text's `(xy {} {})` times PCB_IU_PER_MM must give it back exactly.
   */
  it('the oracle reaches curves, holes and more than one outline per group', () => {
    expect(polyOracle).toHaveLength(14);
    expect(Math.max(...polyOracle.map((o) => o.polygons.length))).toBeGreaterThan(5);
  });

  for (const o of polyOracle) {
    it(`${o.name} at ${o.dpi} DPI`, () => {
      const rows = traced.find((t) => t.name === o.name)!.rows;
      const bm = bitmap(rows[0]!.length, rows.length, (x, y) => rows[y]![x] === '1');
      const text = convert(bm, FOOTPRINT_FMT, o.dpi, o.dpi, 'F.Cu');
      const polys = text
        .split('  (fp_poly\n')
        .slice(1)
        .map((block) =>
          [...block.matchAll(/\(xy (\S+) (\S+)\)/g)].map((m) => [
            Math.round(Number(m[1]) * 1e6),
            Math.round(Number(m[2]) * 1e6),
          ]),
        );
      expect(polys).toEqual(o.polygons);
    });
  }
});
