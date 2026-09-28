// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/gfx_import_utils.cpp`: quantize a raster image into per-colour
 * `SHAPE_POLY_SET`s (one filled pixel-square outline a pixel, unioned by
 * `Fracture`) and drop them into a `LIB_SYMBOL` as `SCH_SHAPE`s — the same
 * "trace a bitmap into filled polygons" step KiCad's `easyeda`/`easyedapro`
 * importers use for an embedded raster image inside a part.
 *
 * We don't build the `easyeda`/`easyedapro` `sch_io` plugins (see
 * `eeschema/STRUCTURE.md`: only `kicad_legacy` and `kicad_sexpr` are ported),
 * so this has no caller here either — ported so the quantize/trace math
 * exists once a raster-embedding importer does. `ConvertImageToPolygons`
 * takes a minimal structural `ImportRasterImage` rather than the `wxImage`
 * class `bitmap2component/wx.ts` keeps (that class has no `SetAlpha`, and
 * pulling `bitmap2component` in as an `eeschema` dependency for one shape
 * would run the wrong direction); a real caller adapts its own decoded image
 * to this shape.
 *
 * `ConvertSVGToLibShapes` (gfx_import_utils.cpp:146) is not ported: it isn't
 * even declared in `gfx_import_utils.h` upstream and has zero callers
 * anywhere in the 10.0.5 tree — dead code there, not a gap here. The SVG
 * import path a live dialog uses is `eeschema/import_gfx/dialog_import_gfx_sch.tsx`
 * via `GRAPHICS_IMPORTER_LIB_SYMBOL`/`SVG_IMPORT_PLUGIN` directly.
 */

import { drawItemLess, type LIB_SYMBOL } from './lib_symbol.js';
import { SCH_SHAPE } from './sch_shape.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { FILL_T, SHAPE_T } from '@ziroeda/common/eda_shape.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/**
 * The minimal `wxImage` surface `ConvertImageToPolygons` reads/writes: pixel
 * dimensions, an RGB(A) getter/setter per pixel, and whether the image has an
 * alpha channel at all.
 */
export interface ImportRasterImage {
  GetWidth(): number;
  GetHeight(): number;
  HasAlpha(): boolean;
  GetRed(x: number, y: number): number;
  GetGreen(x: number, y: number): number;
  GetBlue(x: number, y: number): number;
  GetAlpha(x: number, y: number): number;
  SetRGB(x: number, y: number, r: number, g: number, b: number): void;
  SetAlpha(x: number, y: number, a: number): void;
}

/**
 * `ConvertImageToPolygons` (gfx_import_utils.cpp:31): quantize `img`'s
 * colours to 8 (256/32) steps per channel in place, then build one
 * `SHAPE_POLY_SET` per surviving (non-fully-transparent) quantized colour out
 * of the pixels of that colour, each pixel a closed unit square scaled by
 * `pixelScale`. `color` packs r|g<<8|b<<16|a<<24 as an unsigned 32-bit int,
 * matching the C++ `uint32_t` map key.
 */
export function ConvertImageToPolygons(
  img: ImportRasterImage,
  pixelScale: Vec2,
): Map<number, SHAPE_POLY_SET> {
  const hasAlpha = img.HasAlpha();
  const width = img.GetWidth();
  const height = img.GetHeight();
  const roundBits = 5; // 32

  // Quantize the image
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = img.GetRed(x, y);
      let g = img.GetGreen(x, y);
      let b = img.GetBlue(x, y);
      let a = hasAlpha ? img.GetAlpha(x, y) : 255;

      r = Math.min((r >> roundBits) << roundBits, 0xff);
      g = Math.min((g >> roundBits) << roundBits, 0xff);
      b = Math.min((b >> roundBits) << roundBits, 0xff);
      a = Math.min((a >> roundBits) << roundBits, 0xff);

      img.SetRGB(x, y, r, g, b);

      if (hasAlpha) img.SetAlpha(x, y, a);
    }
  }

  const colorPolys = new Map<number, SHAPE_POLY_SET>();

  // Create polygon sets
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const r = img.GetRed(x, y);
      const g = img.GetGreen(x, y);
      const b = img.GetBlue(x, y);
      const a = hasAlpha ? img.GetAlpha(x, y) : 255;

      if (a > 0) {
        const color = (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;

        let colorPoly = colorPolys.get(color);
        if (!colorPoly) {
          colorPoly = new SHAPE_POLY_SET();
          colorPolys.set(color, colorPoly);
        }

        const chain = new SHAPE_LINE_CHAIN();
        chain.Append(x * pixelScale.x, y * pixelScale.y, true);
        chain.Append((x + 1) * pixelScale.x, y * pixelScale.y, true);
        chain.Append((x + 1) * pixelScale.x, (y + 1) * pixelScale.y, true);
        chain.Append(x * pixelScale.x, (y + 1) * pixelScale.y, true);
        chain.SetClosed(true);

        colorPoly.AddOutline(chain);
      }
    }
  }

  for (const polySet of colorPolys.values()) {
    polySet.Simplify();

    for (let i = 0; i < polySet.OutlineCount(); i++) {
      const poly = polySet.Polygon(i);

      for (const chain of poly) chain.Simplify();
    }
  }

  return colorPolys;
}

/**
 * `ConvertImageToLibShapes` (gfx_import_utils.cpp:106): build one
 * `SCH_SHAPE` (filled, solid colour) per polygon of every colour
 * `ConvertImageToPolygons` finds, append them unsorted to `aSymbol` and sort
 * the draw item list once at the end, the way `LIB_SYMBOL` itself keeps it
 * sorted.
 */
export function ConvertImageToLibShapes(
  aSymbol: LIB_SYMBOL,
  unit: number,
  img: ImportRasterImage,
  pixelScale: Vec2,
  offset: Vec2,
): void {
  const colorPolys = ConvertImageToPolygons(img, pixelScale);

  for (const [color, polySet] of colorPolys) {
    polySet.Fracture();

    for (const poly of polySet.CPolygons()) {
      const shape = new SCH_SHAPE(SHAPE_T.POLY, SCH_LAYER_ID.LAYER_DEVICE);

      shape.SetPolyShape(new SHAPE_POLY_SET(poly));

      const r = color & 0xff;
      const g = (color >>> 8) & 0xff;
      const b = (color >>> 16) & 0xff;
      const a = (color >>> 24) & 0xff;

      shape.SetWidth(-1);
      shape.SetFillMode(FILL_T.FILLED_WITH_COLOR);
      shape.SetFillColor({ r: r / 255.0, g: g / 255.0, b: b / 255.0, a: a / 255.0 } as Color4d);

      shape.SetUnit(unit);

      shape.Move(offset);

      aSymbol.AddDrawItem(shape, false);
    }
  }

  aSymbol.GetDrawItems().sort(drawItemLess);
}
