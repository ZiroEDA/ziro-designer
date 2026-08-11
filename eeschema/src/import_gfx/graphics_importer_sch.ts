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
  type IMPORTED_STROKE,
  COLOR4D_UNSPECIFIED,
  setupSplineOrLine,
} from '@ziroeda/common/src/import_gfx/graphics_importer.js';
import { SCH_IMPORT_MAPPING } from './graphics_importer_sch_mapping.js';
import { LINE_STYLE } from '@ziroeda/common/src/stroke_params.js';
import type { Color4d } from '@ziroeda/common/src/color4d.js';
import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { EuclideanNormI, type Vec2, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePointD } from '@ziroeda/kimath/src/trigo.js';
import {
  makeArc,
  makeBezier,
  makeCircle,
  makeEllipse,
  makeEllipseArc,
  makePolyline,
} from '../tools/build-graphics.js';
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

export class GRAPHICS_IMPORTER_SCH extends SCH_IMPORT_MAPPING<SchImportedItem> {
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
   * `AddEllipse`.
   *
   * The radii take **their own axis factor** — x for the major, y for the minor
   * — rather than the averaged one a stroke gets, because they are lengths in a
   * direction and a non-uniform import should stretch them differently:
   *
   *     ellipse->SetEllipseMajorRadius( KiROUND( aMajorRadius * ImportScalingFactor().x ) );
   *     ellipse->SetEllipseMinorRadius( KiROUND( aMinorRadius * ImportScalingFactor().y ) );
   *
   * That is upstream's simplification, and it is only exact when the ellipse is
   * unrotated; the rotation is carried across untouched either way.
   */
  AddEllipse(
    aCenter: Vec2,
    aMajorRadius: number,
    aMinorRadius: number,
    aRotation: EDA_ANGLE,
    aStroke: IMPORTED_STROKE,
    aFilled: boolean,
    aFillColor: Color4d = COLOR4D_UNSPECIFIED,
  ): void {
    const factor = this.ImportScalingFactor();
    this.addItem({
      type: 'graphic',
      graphic: makeEllipse(
        this.MapCoordinate(aCenter),
        Math.abs(KiROUND(aMajorRadius * factor.x)),
        Math.abs(KiROUND(aMinorRadius * factor.y)),
        aRotation.AsDegrees(),
        this.MapStrokeParams(aStroke),
        this.mapFill(aFilled, aFillColor),
      ),
    });
  }

  /**
   * `AddEllipseArc`. The sweep angles are parametric and measured from the
   * major axis, so they cross unchanged; only the radii are scaled.
   */
  AddEllipseArc(
    aCenter: Vec2,
    aMajorRadius: number,
    aMinorRadius: number,
    aRotation: EDA_ANGLE,
    aStartAngle: EDA_ANGLE,
    aEndAngle: EDA_ANGLE,
    aStroke: IMPORTED_STROKE,
  ): void {
    const factor = this.ImportScalingFactor();
    this.addItem({
      type: 'graphic',
      graphic: makeEllipseArc(
        this.MapCoordinate(aCenter),
        Math.abs(KiROUND(aMajorRadius * factor.x)),
        Math.abs(KiROUND(aMinorRadius * factor.y)),
        aStartAngle.AsDegrees(),
        aEndAngle.AsDegrees(),
        aRotation.AsDegrees(),
        this.MapStrokeParams(aStroke),
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
   * The ninth, **thickness**, is `MapLineWidth( aThickness )` like any other
   * pen — averaged across the two axis factors, because a stroke has no
   * direction. `TextEffects.thickness` and the `(font … (thickness …))` token
   * were added for this: the format always had it, we simply had not read or
   * written it.
   *
   * Sizes are taken absolute: a mirrored import gives a negative scale factor,
   * and a negative glyph box is not a size.
   */
  AddText(
    aOrigin: Vec2,
    aText: string,
    aHeight: number,
    aWidth: number,
    aThickness: number,
    aOrientation: number,
    aHJustify: GR_TEXT_H_ALIGN_T,
    aVJustify: GR_TEXT_V_ALIGN_T,
    aColor: Color4d = COLOR4D_UNSPECIFIED,
  ): void {
    const factor = this.ImportScalingFactor();
    const color = this.toModelColor(aColor);
    this.addItem({
      type: 'text',
      text: makeLabel('text', aText, this.MapCoordinate(aOrigin), {
        angle: aOrientation,
        fontSize: Math.abs(KiROUND(aHeight * factor.y)),
        fontWidth: Math.abs(KiROUND(aWidth * factor.x)),
        thickness: this.MapLineWidth(aThickness),
        justify: [this.hJustify(aHJustify), this.vJustify(aVJustify)],
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
