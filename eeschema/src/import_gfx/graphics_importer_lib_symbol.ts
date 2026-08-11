// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GRAPHICS_IMPORTER_LIB_SYMBOL` — graphics import into a **library symbol**,
 * the Symbol Editor's arm of `EE_GRAPHIC_TOOL::ImportGraphics`. Counterpart:
 * `eeschema/import_gfx/graphics_importer_lib_symbol.{h,cpp}`.
 *
 * ### It is not a coordinate problem
 *
 * The obvious guess — that a library symbol's graphics need flipping, because
 * `.kicad_sym` stores them +Y up — is wrong, and upstream says so by doing
 * nothing about it: `MapCoordinate` here is character-for-character the
 * schematic sink's. KiCad's default `TRANSFORM` is `x1(1) y1(0) x2(0) y2(1)`
 * and ours is the same, so a symbol at angle 0 places its local coordinates
 * straight onto the sheet in both programs. The inversion belongs to the file
 * reader and writer and never reaches an in-memory importer.
 *
 * ### What actually differs from the schematic sink
 *
 * Three things, and only one of them is geometry:
 *
 *   - **the unit.** Upstream sets `SetParent( m_symbol )` and
 *     `SetUnit( m_unit )` on every item, so an import lands in the unit being
 *     edited. Here the sink stays a pure producer of `LibGraphic` and the
 *     *caller* folds them into a unit — `addGraphicToSymbol( sym, g, unit,
 *     bodyStyle )` — because that is where the editor's current unit and body
 *     style live, and a sink that reached for them would be reaching across the
 *     engine/app boundary.
 *   - **a polygon is checked before it is kept** (`IsPolyShapeValid`), which
 *     the schematic sink does not do.
 *   - **a spline decides it is really a line differently.** The schematic sink
 *     asks `setupSplineOrLine` with half the stroke width; this one flattens at
 *     `ARC_LOW_DEF` and demotes when the flattening yields two points or fewer.
 *     Same intent, different test, and they are not interchangeable.
 *
 * Everything else — the width mapping, the `-1` "no stroke" sentinel, the two
 * different fill rules, the arc's too-large-radius fallback — is shared, and
 * lives in `graphics_importer_sch_mapping.ts`. Upstream duplicates those three
 * methods verbatim between its two sinks; sharing them keeps the behaviour
 * identical without the copy.
 */

import {
  COLOR4D_UNSPECIFIED,
  type IMPORTED_STROKE,
} from '@ziroeda/common/src/import_gfx/graphics_importer.js';
import type { Color4d } from '@ziroeda/common/src/color4d.js';
import type { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/src/eda_text.js';
import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { EuclideanNormI, type Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePointD } from '@ziroeda/kimath/src/trigo.js';
import { BezierPoly } from '@ziroeda/kimath/src/bezier_curves.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  makeArc,
  makeBezier,
  makeCircle,
  makeEllipse,
  makeEllipseArc,
  makePolyline,
  makeSymbolText,
} from '../tools/build-graphics.js';
import type { LibGraphic } from '../types.js';
import { SCH_IMPORT_MAPPING } from './graphics_importer_sch_mapping.js';

/**
 * `ARC_LOW_DEF` in schematic IU — the tolerance a spline is flattened at before
 * it is judged degenerate. 0.02 mm, `include/base_units.h`.
 */
const ARC_LOW_DEF_IU = mmToIU(0.02);

export class GRAPHICS_IMPORTER_LIB_SYMBOL extends SCH_IMPORT_MAPPING<LibGraphic> {
  AddLine(aStart: Vec2, aEnd: Vec2, aStroke: IMPORTED_STROKE): void {
    const pt0 = this.MapCoordinate(aStart);
    const pt1 = this.MapCoordinate(aEnd);
    // "Skip 0 len lines".
    if (pt0.x === pt1.x && pt0.y === pt1.y) return;
    // A `LIB_SYMBOL` holds shapes, so a line is a two-point `SHAPE_T::POLY`
    // rather than the `SCH_LINE` a sheet would get.
    this.addItem(makePolyline([pt0, pt1], this.MapStrokeParams(aStroke)));
  }

  AddCircle(
    aCenter: Vec2,
    aRadius: number,
    aStroke: IMPORTED_STROKE,
    aFilled: boolean,
    aFillColor: Color4d = COLOR4D_UNSPECIFIED,
  ): void {
    const center = this.MapCoordinate(aCenter);
    const edge = this.MapCoordinate({ x: aCenter.x + aRadius, y: aCenter.y });
    this.addItem(
      makeCircle(
        center,
        EuclideanNormI({ x: edge.x - center.x, y: edge.y - center.y }),
        this.MapStrokeParams(aStroke),
        this.mapFill(aFilled, aFillColor),
      ),
    );
  }

  AddArc(aCenter: Vec2, aStart: Vec2, aAngle: EDA_ANGLE, aStroke: IMPORTED_STROKE): void {
    const end = RotatePointD(aStart, aCenter, aAngle.negate());
    const mid = RotatePointD(aStart, aCenter, aAngle.negate().divide(2.0));
    const center = this.MapCoordinate(aCenter);
    const start = this.MapCoordinate(aStart);

    if (EuclideanNormI({ x: center.x - start.x, y: center.y - start.y }) >= 2147483647 / 2.0) {
      this.AddLine(aStart, end, aStroke);
      return;
    }

    this.addItem(
      makeArc(
        start,
        this.MapCoordinate(mid),
        this.MapCoordinate(end),
        this.MapStrokeParams(aStroke),
      ),
    );
  }

  /** `IsPolyShapeValid`: an outline of two points or fewer is not a polygon. */
  AddPolygon(
    aVertices: Vec2[],
    aStroke: IMPORTED_STROKE,
    aFilled: boolean,
    aFillColor: Color4d = COLOR4D_UNSPECIFIED,
  ): void {
    const points = aVertices.map((p) => this.MapCoordinate(p));
    if (points.length === 0) return;
    // "Need to close last point for libedit" — the repeat is explicit upstream.
    const closed = [...points, points[0]!];
    if (points.length <= 2) return;
    this.addItem(
      makePolyline(closed, this.MapStrokeParams(aStroke), this.mapPolygonFill(aFilled, aFillColor)),
    );
  }

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
    this.addItem(
      makeSymbolText(aText, this.MapCoordinate(aOrigin), aOrientation, {
        fontSize: Math.abs(KiROUND(aHeight * factor.y)),
        fontWidth: Math.abs(KiROUND(aWidth * factor.x)),
        thickness: this.MapLineWidth(aThickness),
        justify: [this.hJustify(aHJustify), this.vJustify(aVJustify)],
        ...(this.toModelColor(aColor) ? { color: this.toModelColor(aColor)! } : {}),
      }),
    );
  }

  /**
   * A cubic, unless flattening says it is really a segment.
   *
   *     spline->RebuildBezierToSegmentsPointsList( schIUScale.mmToIU( ARC_LOW_DEF_MM ) );
   *     if( spline->GetBezierPoints().size() <= 2 )
   *         AddLine( aStart, aEnd, aStroke );
   *
   * Deliberately *not* the schematic sink's `setupSplineOrLine`, which judges by
   * half the stroke width. Same intent, different test.
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

    if (new BezierPoly([start, c1, c2, end]).getPoly(ARC_LOW_DEF_IU).length <= 2) {
      this.AddLine(aStart, aEnd, aStroke);
      return;
    }

    this.addItem(makeBezier(start, c1, c2, end, this.MapStrokeParams(aStroke)));
  }

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
    this.addItem(
      makeEllipse(
        this.MapCoordinate(aCenter),
        Math.abs(KiROUND(aMajorRadius * factor.x)),
        Math.abs(KiROUND(aMinorRadius * factor.y)),
        aRotation.AsDegrees(),
        this.MapStrokeParams(aStroke),
        this.mapFill(aFilled, aFillColor),
      ),
    );
  }

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
    this.addItem(
      makeEllipseArc(
        this.MapCoordinate(aCenter),
        Math.abs(KiROUND(aMajorRadius * factor.x)),
        Math.abs(KiROUND(aMinorRadius * factor.y)),
        aStartAngle.AsDegrees(),
        aEndAngle.AsDegrees(),
        aRotation.AsDegrees(),
        this.MapStrokeParams(aStroke),
      ),
    );
  }
}
