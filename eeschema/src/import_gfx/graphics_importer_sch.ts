// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GRAPHICS_IMPORTER_SCH`, the half of graphics import that knows about
 * schematics. Counterpart: `eeschema/import_gfx/graphics_importer_sch.{h,cpp}`.
 *
 * The parsers, the buffer and the primitive sink are shared and live in
 * `common/src/import_gfx/`. Everything arriving here is millimetres in the
 * source drawing's frame; everything leaving is a schematic-model record in
 * internal units, ready to be committed.
 *
 * The conversion is `MapCoordinate`, and its order matters — scale, **then add
 * the offset**, then multiply by the mm-to-IU factor. The offset is therefore
 * in millimetres of the already-scaled drawing rather than of the file, so
 * halving the import scale still lands the drawing in the same place. The
 * schematic's IU differ from the board's, which is the only reason this class
 * exists separately from `GRAPHICS_IMPORTER_PCBNEW`: `m_millimeterToIu` is
 * `schIUScale`, not `pcbIUScale`.
 *
 * Widths take a different route. `MapLineWidth` averages the X and Y scale
 * factors, because a stroke has no direction to be scaled along, and truncates
 * rather than rounding — a C++ `int(double)` cast, kept as `Math.trunc`.
 *
 * ### The width sentinel is real here, unlike on the board
 *
 *     // Historicaly -1 meant no-stroke in Eeschema.
 *     int width = ( aStroke.GetWidth() == -1 ) ? -1 : MapLineWidth( aStroke.GetWidth() );
 *
 * so -1 is passed through rather than mapped. It is not a rounding artefact and
 * must not be clamped: our renderer already reads it the same way KiCad does —
 * `const drawn = (stroke) => (stroke?.width ?? 0) >= 0` — so a -1 shape is
 * filled and not outlined, and anything <= 0 that *is* drawn falls back to the
 * default pen. Mapping it to 0 would silently give every unstroked import an
 * outline.
 */

import { schIUScale } from '@ziroeda/common/src/eda_units.js';
import type { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/src/eda_text.js';
import {
  GRAPHICS_IMPORTER,
  type IMPORTED_STROKE,
  COLOR4D_UNSPECIFIED,
  setupSplineOrLine,
} from '@ziroeda/common/src/import_gfx/graphics_importer.js';
import { LINE_STYLE } from '@ziroeda/common/src/stroke_params.js';
import type { Color4d } from '@ziroeda/common/src/color4d.js';
import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { EuclideanNormI, type Vec2, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePointD } from '@ziroeda/kimath/src/trigo.js';
import { makeArc, makeBezier, makeCircle, makePolyline } from '../tools/build-graphics.js';
import { makeLabel } from '../tools/build.js';
import type { Fill, LibGraphic, SchLabel, Stroke } from '../types.js';

/**
 * What a schematic import produces.
 *
 * Two arms rather than one because free text is not a graphic in this model: a
 * `(text …)` is a `SchLabel` of kind `text` and lives in `doc.labels`, while
 * every shape is a `LibGraphic` in `doc.graphics`. Upstream draws the same line
 * — `SCH_TEXT` is not a `SCH_SHAPE`.
 */
export type SchImportedItem =
  | { type: 'graphic'; graphic: LibGraphic }
  | { type: 'text'; text: SchLabel };

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

export class GRAPHICS_IMPORTER_SCH extends GRAPHICS_IMPORTER<SchImportedItem> {
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
  private mapFill(aFilled: boolean, aFillColor: Color4d): Fill {
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
  private mapPolygonFill(aFilled: boolean, aFillColor: Color4d): Fill {
    const color = toModelColor(aFillColor);
    if (!aFilled) return color ? { type: 'none', color } : { type: 'none' };
    return color ? { type: 'color', color } : { type: 'outline' };
  }

  AddLine(aStart: Vec2, aEnd: Vec2, aStroke: IMPORTED_STROKE): void {
    const pt0 = this.MapCoordinate(aStart);
    const pt1 = this.MapCoordinate(aEnd);
    // "Skip 0 len lines" — a zero-length segment is a conversion artefact.
    if (pt0.x === pt1.x && pt0.y === pt1.y) return;
    this.addItem({
      type: 'graphic',
      graphic: makePolyline([pt0, pt1], this.MapStrokeParams(aStroke)),
    });
  }

  AddCircle(
    aCenter: Vec2,
    aRadius: number,
    aStroke: IMPORTED_STROKE,
    aFilled: boolean,
    aFillColor: Color4d = COLOR4D_UNSPECIFIED,
  ): void {
    // Upstream sets start = centre and end = centre + (r, 0), so the radius is
    // the mapped distance between them rather than a separately scaled scalar.
    const center = this.MapCoordinate(aCenter);
    const edge = this.MapCoordinate({ x: aCenter.x + aRadius, y: aCenter.y });
    const radius = EuclideanNormI({ x: edge.x - center.x, y: edge.y - center.y });
    this.addItem({
      type: 'graphic',
      graphic: makeCircle(
        center,
        radius,
        this.MapStrokeParams(aStroke),
        this.mapFill(aFilled, aFillColor),
      ),
    });
  }

  /**
   * The rotation is done in floating point *before* mapping, "to avoid rounding
   * errors when operating in integer space in KiCad".
   *
   * An arc whose radius reaches half the coordinate range cannot be stored and
   * degrades to its chord rather than being dropped — upstream cannot test the
   * final coordinates, because the arc may still be moved before it is placed.
   */
  AddArc(aCenter: Vec2, aStart: Vec2, aAngle: EDA_ANGLE, aStroke: IMPORTED_STROKE): void {
    const end = RotatePointD(aStart, aCenter, aAngle.negate());
    const mid = RotatePointD(aStart, aCenter, aAngle.negate().divide(2.0));

    const center = this.MapCoordinate(aCenter);
    const start = this.MapCoordinate(aStart);
    const radius = EuclideanNormI({ x: center.x - start.x, y: center.y - start.y });

    if (radius >= 2147483647 / 2.0) {
      this.AddLine(aStart, end, aStroke);
      return;
    }

    this.addItem({
      type: 'graphic',
      graphic: makeArc(
        start,
        this.MapCoordinate(mid),
        this.MapCoordinate(end),
        this.MapStrokeParams(aStroke),
      ),
    });
  }

  AddPolygon(
    aVertices: Vec2[],
    aStroke: IMPORTED_STROKE,
    aFilled: boolean,
    aFillColor: Color4d = COLOR4D_UNSPECIFIED,
  ): void {
    const points = aVertices.map((p) => this.MapCoordinate(p));
    if (points.length === 0) return;
    // "Need to close last point for libedit" — upstream repeats the first
    // vertex rather than relying on an implicit close.
    this.addItem({
      type: 'graphic',
      graphic: makePolyline(
        [...points, points[0]!],
        this.MapStrokeParams(aStroke),
        this.mapPolygonFill(aFilled, aFillColor),
      ),
    });
  }

  /**
   * Free text as a `SCH_TEXT`.
   *
   * Upstream sets nine things on it and eight of them survive: position, the
   * string, the angle, height and width (each scaled by *its own* axis factor,
   * because text has a direction where a stroke does not), both justifications
   * and the colour.
   *
   *     textItem->SetTextWidth( aWidth * ImportScalingFactor().x );
   *     textItem->SetTextHeight( aHeight * ImportScalingFactor().y );
   *
   * The ninth, **thickness**, is dropped because the model has nowhere to put
   * it: there is no pen width on schematic text in `TextEffects`, and the
   * reader and writer have no `(thickness …)` either. That is a model gap
   * rather than a mapping choice, so it is the one thing here that cannot be
   * made identical without widening the format support.
   *
   * Sizes are taken absolute: a mirrored import gives a negative scale factor,
   * and a negative glyph box is not a size.
   */
  AddText(
    aOrigin: Vec2,
    aText: string,
    aHeight: number,
    aWidth: number,
    // biome-ignore lint/correctness/noUnusedFunctionParameters: no pen width on schematic text
    aThickness: number,
    aOrientation: number,
    aHJustify: GR_TEXT_H_ALIGN_T,
    aVJustify: GR_TEXT_V_ALIGN_T,
    aColor: Color4d = COLOR4D_UNSPECIFIED,
  ): void {
    const factor = this.ImportScalingFactor();
    const color = toModelColor(aColor);
    this.addItem({
      type: 'text',
      text: makeLabel('text', aText, this.MapCoordinate(aOrigin), {
        angle: aOrientation,
        fontSize: Math.abs(KiROUND(aHeight * factor.y)),
        fontWidth: Math.abs(KiROUND(aWidth * factor.x)),
        justify: [hJustifyToken(aHJustify), vJustifyToken(aVJustify)],
        ...(color ? { color } : {}),
      }),
    });
  }

  /**
   * A cubic, unless `setupSplineOrLine` says it is really a segment — in which
   * case upstream re-adds it through `AddLine`, because "SCH_LINES aren't
   * SCH_SHAPES". The accuracy it judges by is **half the stroke width**, not
   * the arc tolerance the board sink passes.
   */
  AddSpline(
    aStart: Vec2,
    aBezierControl1: Vec2,
    aBezierControl2: Vec2,
    aEnd: Vec2,
    aStroke: IMPORTED_STROKE,
  ): void {
    const start = this.MapCoordinate(aStart);
    const c1 = this.MapCoordinate(aBezierControl1);
    const c2 = this.MapCoordinate(aBezierControl2);
    const end = this.MapCoordinate(aEnd);

    const kind = setupSplineOrLine(start, c1, c2, end, aStroke.GetWidth() / 2);
    if (kind === null) return;
    if (kind === 'line') {
      this.AddLine(aStart, aEnd, aStroke);
      return;
    }
    this.addItem({
      type: 'graphic',
      graphic: makeBezier(start, c1, c2, end, this.MapStrokeParams(aStroke)),
    });
  }
}
