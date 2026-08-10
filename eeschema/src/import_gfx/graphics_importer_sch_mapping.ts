// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The mapping both schematic graphics-import sinks share.
 *
 * Upstream has two sinks — `GRAPHICS_IMPORTER_SCH` for a sheet and
 * `GRAPHICS_IMPORTER_LIB_SYMBOL` for a library symbol — and **duplicates these
 * methods verbatim between them**: `MapCoordinate`, `MapLineWidth` and
 * `MapStrokeParams` are the same code in both files, because both map into
 * schematic internal units. Sharing them here keeps the behaviour identical
 * without the copy; the sinks then differ only where upstream's differ.
 *
 * The order in `MapCoordinate` matters and is easy to get wrong: scale, **then
 * add the offset**, then multiply by the mm-to-IU factor. The offset is
 * therefore in millimetres of the already-scaled drawing rather than of the
 * file, so halving the import scale still lands the drawing in the same place.
 *
 * Widths take a different route: `MapLineWidth` averages the X and Y factors,
 * because a stroke has no direction to be scaled along, and **truncates** rather
 * than rounding — a C++ `int(double)` cast, kept as `Math.trunc`.
 *
 * The `-1` stroke width is Eeschema's "no stroke" sentinel and is passed
 * through rather than mapped. It must not be clamped: our renderer reads it the
 * way KiCad does (`(stroke?.width ?? 0) >= 0`), so a `-1` shape is filled and
 * not outlined, and mapping it to 0 would give every unstroked import an
 * outline.
 */

import {
  GRAPHICS_IMPORTER,
  type IMPORTED_STROKE,
  COLOR4D_UNSPECIFIED,
} from '@ziroeda/common/src/import_gfx/graphics_importer.js';
import { LINE_STYLE } from '@ziroeda/common/src/stroke_params.js';
import type { Color4d } from '@ziroeda/common/src/color4d.js';
import type { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/src/eda_text.js';
import { schIUScale } from '@ziroeda/common/src/eda_units.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { Vec2, VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { Fill, Stroke } from '../types.js';

/** `LINE_STYLE` as the **schematic** file spells it. */
function lineStyleToSchStroke(aStyle: LINE_STYLE): string {
  switch (aStyle) {
    case LINE_STYLE.DEFAULT:
      return 'default';
    case LINE_STYLE.SOLID:
      return 'solid';
    case LINE_STYLE.DASH:
      return 'dash';
    case LINE_STYLE.DOT:
      return 'dot';
    case LINE_STYLE.DASHDOT:
      return 'dash_dot';
    case LINE_STYLE.DASHDOTDOT:
      return 'dash_dot_dot';
  }
}

/** `GR_TEXT_H_ALIGN_T` as the `(justify …)` token the file spells it with. */
function hJustifyToken(a: GR_TEXT_H_ALIGN_T): string {
  return a === -1 ? 'left' : a === 1 ? 'right' : 'center';
}

/** `GR_TEXT_V_ALIGN_T`, likewise. */
function vJustifyToken(a: GR_TEXT_V_ALIGN_T): string {
  return a === -1 ? 'top' : a === 1 ? 'bottom' : 'center';
}

/** `COLOR4D` (components 0..1) as the model's `[r, g, b, a]` with rgb 0..255. */
function toModelColor(c: Color4d): readonly [number, number, number, number] | undefined {
  // COLOR4D::UNSPECIFIED is alpha 0, meaning "no colour given" rather than
  // "transparent", so it is dropped instead of written as a transparent black.
  if (c.a === COLOR4D_UNSPECIFIED.a && c.r === 0 && c.g === 0 && c.b === 0) return undefined;
  return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255), c.a];
}

export abstract class SCH_IMPORT_MAPPING<TItem> extends GRAPHICS_IMPORTER<TItem> {
  constructor() {
    super();
    this.m_millimeterToIu = schIUScale.mmToIU(1.0);
  }

  MapCoordinate(aCoordinate: Vec2): VECTOR2I {
    const scale = this.GetScale();
    const offset = this.GetImportOffsetMM();
    const f = this.GetMillimeterToIuFactor();
    return {
      x: KiROUND((aCoordinate.x * scale.x + offset.x) * f),
      y: KiROUND((aCoordinate.y * scale.y + offset.y) * f),
    };
  }

  /** Truncating, not rounding: upstream casts the double to `int`. */
  MapLineWidth(aLineWidth: number): number {
    const factor = this.ImportScalingFactor();
    const scale = (Math.abs(factor.x) + Math.abs(factor.y)) * 0.5;
    if (aLineWidth <= 0.0) return Math.trunc(this.GetLineWidthMM() * scale);
    return Math.trunc(aLineWidth * scale);
  }

  /** `MapStrokeParams`, including the -1 pass-through described in the header. */
  MapStrokeParams(aStroke: IMPORTED_STROKE): Stroke {
    const width = aStroke.GetWidth() === -1 ? -1 : this.MapLineWidth(aStroke.GetWidth());
    const color = toModelColor(aStroke.GetColor());
    const type = lineStyleToSchStroke(aStroke.GetPlotStyle());
    return color ? { width, type, color } : { width, type };
  }

  /**
   * The `(fill …)` a **circle, arc or ellipse** gets.
   *
   *     circle->SetFillColor( aFillColor );
   *     circle->SetFilled( aFilled );
   *
   * `SetFilled( true )` is `FILL_T::FILLED_SHAPE` — `outline` in the file — and
   * the colour is stored alongside it whatever the mode. Note this is *not* the
   * polygon rule below: a filled circle that came with a colour is still
   * `outline`, not `color`.
   */
  protected mapFill(aFilled: boolean, aFillColor: Color4d): Fill {
    const color = toModelColor(aFillColor);
    const type = aFilled ? 'outline' : 'none';
    return color ? { type, color } : { type };
  }

  /**
   * The `(fill …)` a **polygon** gets, which upstream decides differently:
   *
   *     polygon->SetFillMode( aFillColor != COLOR4D::UNSPECIFIED ? FILL_T::FILLED_WITH_COLOR
   *                                                              : FILL_T::FILLED_SHAPE );
   */
  protected mapPolygonFill(aFilled: boolean, aFillColor: Color4d): Fill {
    const color = toModelColor(aFillColor);
    if (!aFilled) return color ? { type: 'none', color } : { type: 'none' };
    return color ? { type: 'color', color } : { type: 'outline' };
  }

  /** `GR_TEXT_H_ALIGN_T` as the `(justify …)` token, for the sinks. */
  protected hJustify(a: GR_TEXT_H_ALIGN_T): string {
    return hJustifyToken(a);
  }

  /** `GR_TEXT_V_ALIGN_T`, likewise. */
  protected vJustify(a: GR_TEXT_V_ALIGN_T): string {
    return vJustifyToken(a);
  }

  /** `COLOR4D` as the model's `[r, g, b, a]`, or undefined when unspecified. */
  protected toModelColor(c: Color4d): readonly [number, number, number, number] | undefined {
    return toModelColor(c);
  }
}
