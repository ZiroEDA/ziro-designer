// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `callback_gal.h` / `common/callback_gal.cpp`: a GAL that hands every
 * stroke, triangle or outline it is asked to draw to a callback. The text
 * shapes (`EDA_TEXT::GetEffectiveTextShape`) and the plotters draw through it.
 */

import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import {
  SHAPE_POLY_SET,
  TransformOvalToPolygon,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { type VECTOR2I, toVECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { type GLYPH_LIKE, OUTLINE_GLYPH, type STROKE_GLYPH } from './font/glyph.js';
import { GAL } from './gal/graphics_abstraction_layer.js';
import { GAL_DISPLAY_OPTIONS } from './gal/gal_display_options.js';

export type StrokeCallback = (aPt1: VECTOR2I, aPt2: VECTOR2I) => void;
export type TriangleCallback = (aPt1: VECTOR2I, aPt2: VECTOR2I, aPt3: VECTOR2I) => void;
export type OutlineCallback = (aPoly: SHAPE_LINE_CHAIN) => void;

export class CALLBACK_GAL extends GAL {
  private m_strokeCallback: StrokeCallback;
  private m_triangleCallback: TriangleCallback;
  private m_outlineCallback: OutlineCallback;

  private m_stroke: boolean;
  private m_triangulate: boolean;

  /** Strokes and triangles. */
  constructor(aStrokeCallback: StrokeCallback, aTriangleCallback: TriangleCallback);
  /** Strokes and outlines. */
  constructor(aStrokeCallback: StrokeCallback, aOutlineCallback: OutlineCallback);
  /** Outlines only. */
  constructor(aOutlineCallback: OutlineCallback);
  constructor(a: StrokeCallback | OutlineCallback, b?: TriangleCallback | OutlineCallback) {
    // The callers construct an empty `GAL_DISPLAY_OPTIONS` to hand the C++ ctor;
    // here it is made in one place.
    super(new GAL_DISPLAY_OPTIONS());

    if (b === undefined) {
      this.m_strokeCallback = () => {};
      this.m_triangleCallback = () => {};
      this.m_outlineCallback = a as OutlineCallback;
      this.m_stroke = false;
      this.m_triangulate = false;
    } else if (b.length === 3) {
      this.m_strokeCallback = a as StrokeCallback;
      this.m_triangleCallback = b as TriangleCallback;
      this.m_outlineCallback = () => {};
      this.m_stroke = true;
      this.m_triangulate = true;
    } else {
      this.m_strokeCallback = a as StrokeCallback;
      this.m_triangleCallback = () => {};
      this.m_outlineCallback = b as OutlineCallback;
      this.m_stroke = true;
      this.m_triangulate = false;
    }
  }

  override DrawGlyph(aGlyph: GLYPH_LIKE, aNth: number, aTotal: number): void {
    if (aGlyph.IsStroke()) {
      const glyph = aGlyph as STROKE_GLYPH;

      for (const pointList of glyph.strokes) {
        for (let ii = 1; ii < pointList.length; ii++) {
          // The glyph points are VECTOR2D; the callbacks take VECTOR2I (the casting ctor).
          if (this.m_stroke) {
            this.m_strokeCallback(toVECTOR2I(pointList[ii - 1]!), toVECTOR2I(pointList[ii]!));
          } else {
            const strokeWidth = Math.trunc(this.GetLineWidth());
            const poly = new SHAPE_POLY_SET();

            // Use ERROR_INSIDE because it avoids Clipper and is therefore much faster.
            TransformOvalToPolygon(
              poly,
              toVECTOR2I(pointList[ii - 1]!),
              toVECTOR2I(pointList[ii]!),
              strokeWidth,
              Math.trunc(strokeWidth / 180),
              ERROR_LOC.ERROR_INSIDE,
            );

            this.m_outlineCallback(poly.Outline(0));
          }
        }
      }
    } else if (aGlyph.IsOutline()) {
      if (this.m_triangulate) {
        const glyph = aGlyph as OUTLINE_GLYPH;

        glyph.Triangulate(this.m_triangleCallback);
      } else {
        const glyph = new OUTLINE_GLYPH(aGlyph as OUTLINE_GLYPH);

        if (glyph.HasHoles()) glyph.Fracture();

        for (let ii = 0; ii < glyph.OutlineCount(); ++ii) this.m_outlineCallback(glyph.Outline(ii));
      }
    }
  }
}
