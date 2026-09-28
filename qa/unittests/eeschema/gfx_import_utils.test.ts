// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ConvertImageToPolygons` / `ConvertImageToLibShapes` (gfx_import_utils.cpp):
 * quantize a raster image to one filled `SCH_SHAPE` polygon per surviving
 * colour.
 */
import { FILL_T, SHAPE_T } from '@ziroeda/common/eda_shape.js';
import {
  ConvertImageToLibShapes,
  ConvertImageToPolygons,
  type ImportRasterImage,
} from '@ziroeda/eeschema/gfx_import_utils.js';
import { LIB_SYMBOL } from '@ziroeda/eeschema/lib_symbol.js';
import type { SCH_SHAPE } from '@ziroeda/eeschema/sch_shape.js';
import { describe, expect, it } from 'vitest';

/** A tiny RGBA raster, addressed [y][x], for `ImportRasterImage`. */
class TestImage implements ImportRasterImage {
  private w: number;
  private h: number;
  private r: number[];
  private g: number[];
  private b: number[];
  private a: number[];
  private alpha: boolean;

  constructor(width: number, height: number, hasAlpha: boolean) {
    this.w = width;
    this.h = height;
    this.alpha = hasAlpha;
    const n = width * height;
    this.r = new Array(n).fill(0);
    this.g = new Array(n).fill(0);
    this.b = new Array(n).fill(0);
    this.a = new Array(n).fill(255);
  }

  private idx(x: number, y: number): number {
    return y * this.w + x;
  }

  GetWidth(): number {
    return this.w;
  }
  GetHeight(): number {
    return this.h;
  }
  HasAlpha(): boolean {
    return this.alpha;
  }
  GetRed(x: number, y: number): number {
    return this.r[this.idx(x, y)]!;
  }
  GetGreen(x: number, y: number): number {
    return this.g[this.idx(x, y)]!;
  }
  GetBlue(x: number, y: number): number {
    return this.b[this.idx(x, y)]!;
  }
  GetAlpha(x: number, y: number): number {
    return this.a[this.idx(x, y)]!;
  }
  SetRGB(x: number, y: number, r: number, g: number, b: number): void {
    const i = this.idx(x, y);
    this.r[i] = r;
    this.g[i] = g;
    this.b[i] = b;
  }
  SetAlpha(x: number, y: number, a: number): void {
    this.a[this.idx(x, y)] = a;
  }
  setPixel(x: number, y: number, r: number, g: number, b: number, a = 255): void {
    this.SetRGB(x, y, r, g, b);
    this.SetAlpha(x, y, a);
  }
}

describe('ConvertImageToPolygons', () => {
  it('produces one entry per surviving quantized colour', () => {
    const img = new TestImage(2, 1, true);
    img.setPixel(0, 0, 255, 0, 0, 255); // red
    img.setPixel(1, 0, 0, 255, 0, 255); // green

    const polys = ConvertImageToPolygons(img, { x: 10, y: 10 });

    expect(polys.size).toBe(2);
    for (const polySet of polys.values()) {
      expect(polySet.OutlineCount()).toBe(1);
    }
  });

  it('drops fully-transparent pixels entirely', () => {
    const img = new TestImage(2, 1, true);
    img.setPixel(0, 0, 255, 0, 0, 255);
    img.setPixel(1, 0, 10, 10, 10, 0); // alpha 0 -> no polygon

    const polys = ConvertImageToPolygons(img, { x: 10, y: 10 });

    expect(polys.size).toBe(1);
  });

  it('quantizes colour channels to 32-step buckets (round bits = 5)', () => {
    const img = new TestImage(2, 1, false);
    // 250 and 255 both floor to the same 32-wide bucket (224, clamped to 0xff
    // by min()), so both pixels must land in the same colour bucket.
    img.setPixel(0, 0, 250, 250, 250, 255);
    img.setPixel(1, 0, 255, 255, 255, 255);

    const polys = ConvertImageToPolygons(img, { x: 10, y: 10 });

    // Both pixels land in the same colour bucket, so `Simplify()` unions
    // their two adjacent unit squares into a single 2-wide outline.
    expect(polys.size).toBe(1);
    const polySet = [...polys.values()][0]!;
    expect(polySet.OutlineCount()).toBe(1);
    const outline = polySet.Outline(0);
    const xs: number[] = [];
    for (let i = 0; i < outline.PointCount(); i++) xs.push(outline.CPoint(i).x);
    expect(Math.max(...xs)).toBe(20);
  });

  it('scales each pixel square by pixelScale', () => {
    const img = new TestImage(1, 1, false);
    img.setPixel(0, 0, 1, 2, 3, 255);

    const polys = ConvertImageToPolygons(img, { x: 7, y: 11 });
    const polySet = [...polys.values()][0]!;
    const outline = polySet.Outline(0);

    expect(outline.PointCount()).toBe(4);
    // Pixel (0,0) -> the unit square [0,7] x [0,11].
    const xs = [];
    const ys = [];
    for (let i = 0; i < outline.PointCount(); i++) {
      xs.push(outline.CPoint(i).x);
      ys.push(outline.CPoint(i).y);
    }
    expect(Math.max(...xs)).toBe(7);
    expect(Math.max(...ys)).toBe(11);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.min(...ys)).toBe(0);
  });
});

describe('ConvertImageToLibShapes', () => {
  it('adds one filled SCH_SHAPE per colour to the symbol, then sorts', () => {
    const symbol = new LIB_SYMBOL('test');
    const img = new TestImage(2, 1, true);
    img.setPixel(0, 0, 255, 0, 0, 255); // red
    img.setPixel(1, 0, 0, 255, 0, 255); // green

    ConvertImageToLibShapes(symbol, 1, img, { x: 10, y: 10 }, { x: 0, y: 0 });

    // A fresh LIB_SYMBOL already carries its 5 mandatory fields as draw
    // items; only the SHAPE_T.POLY items are the ones this call added.
    const shapes = [...symbol.GetDrawItems()].filter(
      (item) => item.GetClass() === 'SCH_SHAPE',
    ) as SCH_SHAPE[];
    expect(shapes.length).toBe(2);

    for (const shape of shapes) {
      expect(shape.GetShape()).toBe(SHAPE_T.POLY);
      expect(shape.GetFillMode()).toBe(FILL_T.FILLED_WITH_COLOR);
      expect(shape.GetUnit()).toBe(1);
    }

    // 255 quantizes to 224 (255 >> 5 << 5), so a "red" input pixel's fill
    // colour is 224/255, not 1.0.
    const q = 224 / 255;
    const colors = shapes.map((s) => s.GetFillColor());
    expect(colors.some((c) => c.r === q && c.g === 0 && c.b === 0)).toBe(true);
    expect(colors.some((c) => c.r === 0 && c.g === q && c.b === 0)).toBe(true);
  });

  it('offsets each shape by the given offset', () => {
    const symbol = new LIB_SYMBOL('test');
    const img = new TestImage(1, 1, false);
    img.setPixel(0, 0, 128, 128, 128, 255);

    ConvertImageToLibShapes(symbol, 0, img, { x: 10, y: 10 }, { x: 1000, y: 2000 });

    const [shape] = [...symbol.GetDrawItems()].filter(
      (item) => item.GetClass() === 'SCH_SHAPE',
    ) as SCH_SHAPE[];
    const outline = shape!.GetPolyShape().Outline(0);
    const xs = [];
    for (let i = 0; i < outline.PointCount(); i++) xs.push(outline.CPoint(i).x);
    expect(Math.min(...xs)).toBe(1000);
    expect(Math.max(...xs)).toBe(1010);
  });
});
