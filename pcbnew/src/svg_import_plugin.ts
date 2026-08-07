// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SVG_IMPORT_PLUGIN. Counterpart: `common/import_gfx/svg_import_plugin.{h,cpp}`.
 *
 * nanosvg (`nanosvg.ts`) turns the document into shapes made of cubic Béziers;
 * this file decides what each of those becomes on the board. Everything it
 * hands the importer is in **millimetres** and it scales nothing — the
 * placement model (`m_scale`, `m_offsetCoordmm`, `m_millimeterToIu`) lives in
 * `GRAPHICS_IMPORTER` and a parser that pre-multiplied would apply the user's
 * import ratio twice. The millimetres come from asking nanosvg for `"mm"` at
 * `SVG_DPI = 96`.
 *
 * Two decisions here are worth reading before changing anything.
 *
 * **Closed becomes a polygon; open becomes splines.** `DrawPath` interpolates a
 * closed path into points and emits one `AddPolygon`; anything else is emitted
 * as a run of `AddSpline` calls, one per cubic, and the importer decides later
 * whether each is a curve or a straight segment. The consequence is that a
 * closed path loses its control points and an open one keeps them.
 *
 * **A filled *open* path is imported twice.** KiCad has no single object for a
 * filled shape that is not closed, so the fill is emitted as a closed, filled,
 * *stroke-less* polygon and the outline as a separate open, unfilled spline
 * run — and only if the stroke has a positive width. Collapsing that into one
 * shape changes what the board looks like.
 *
 * Faithfully reproduced oddities, none of which is to be "fixed":
 *  - the Bézier subdivision tolerance is measured over the start point and the
 *    two control points and **never the end point** (see
 *    `calculateBezierSegmentationThreshold`);
 *  - a fill or stroke colour that reads as pure opaque black is thrown away as
 *    "nanosvg probably didn't read it properly";
 *  - the dash-pattern classifier only looks at the even entries of the dash
 *    array — the dashes, never the gaps;
 *  - `DrawLineSegments` is dead code upstream. Ported, because it is part of
 *    the class, and marked as such.
 */

import {
  BOX2D,
  COLOR4D_UNSPECIFIED,
  GRAPHICS_IMPORTER_BUFFER,
  IMPORTED_STROKE,
  POLY_FILL_RULE,
  type GRAPHICS_IMPORTER,
} from './graphics_importer.js';
import { NSVG_FLAGS_VISIBLE, NSVGfillRule, NSVGpaintType, nsvgParse } from './nanosvg.js';
import type { NSVGimage } from './nanosvg.js';
import { COLOR4D_BLACK, LINE_STYLE, type Color4d } from './plot_dxf.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** `SVG_DPI`. Every SVG user unit is 1/96 inch unless the document says otherwise. */
const SVG_DPI = 96;

/** `inches2mm`. */
const inches2mm = 25.4;

const colorEquals = (a: Color4d, b: Color4d): boolean =>
  a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

/** `std::clamp( v, 0u, 255u ) / 255.0` on one byte of a packed colour. */
const channel = (icolor: number, shift: number): number => ((icolor >>> shift) & 0xff) / 255.0;

/**
 * `getPointInLine( a, b, t )` — the de Casteljau step. Not a lerp helper to be
 * shared: upstream spells the whole subdivision out of this one primitive.
 */
const getPointInLine = (aLineStart: Vec2, aLineEnd: Vec2, aDistance: number): Vec2 => ({
  x: aLineStart.x + (aLineEnd.x - aLineStart.x) * aDistance,
  y: aLineStart.y + (aLineEnd.y - aLineStart.y) * aDistance,
});

/** `getPoint`: two floats out of nanosvg's flat point array. */
const getPoint = (aCoords: number[], aOffset: number): Vec2 => ({
  x: aCoords[aOffset]!,
  y: aCoords[aOffset + 1]!,
});

/**
 * `getBezierPoint`: de Casteljau at parameter `aStep`, evaluated exactly as
 * upstream does — cubic to quadratic to linear to point.
 */
export function getBezierPoint(aCoords: number[], aOffset: number, aStep: number): Vec2 {
  const coordinatesPerPoint = 2;

  const firstCubicPoint = getPoint(aCoords, aOffset);
  const secondCubicPoint = getPoint(aCoords, aOffset + 1 * coordinatesPerPoint);
  const thirdCubicPoint = getPoint(aCoords, aOffset + 2 * coordinatesPerPoint);
  const fourthCubicPoint = getPoint(aCoords, aOffset + 3 * coordinatesPerPoint);

  const firstQuadraticPoint = getPointInLine(firstCubicPoint, secondCubicPoint, aStep);
  const secondQuadraticPoint = getPointInLine(secondCubicPoint, thirdCubicPoint, aStep);
  const thirdQuadraticPoint = getPointInLine(thirdCubicPoint, fourthCubicPoint, aStep);

  const firstLinearPoint = getPointInLine(firstQuadraticPoint, secondQuadraticPoint, aStep);
  const secondLinearPoint = getPointInLine(secondQuadraticPoint, thirdQuadraticPoint, aStep);

  return getPointInLine(firstLinearPoint, secondLinearPoint, aStep);
}

/**
 * `calculateBezierBoundingBoxExtremity`.
 *
 * **Upstream bug, reproduced.** The loop is `for( pointIndex = 1; pointIndex <
 * 3; ++pointIndex )`, so it visits points 0, 1 and 2 — the start point and the
 * two control points — and never point 3, the end. Every tolerance computed
 * from this is therefore the extent of three quarters of the curve's control
 * polygon. Making it `< 4` would change the segment count of every imported
 * curve, which is why it is pinned by a test rather than fixed.
 */
function calculateBezierBoundingBoxExtremity(
  aCoords: number[],
  aOffset: number,
  comparator: (a: number, b: number) => number,
): Vec2 {
  let x = aCoords[aOffset]!;
  let y = aCoords[aOffset + 1]!;

  for (let pointIndex = 1; pointIndex < 3; ++pointIndex) {
    x = comparator(x, aCoords[aOffset + 2 * pointIndex]!);
    y = comparator(y, aCoords[aOffset + 2 * pointIndex + 1]!);
  }

  return { x, y };
}

/**
 * `calculateBezierSegmentationThreshold`: one thousandth of the larger side of
 * the (three-point, see above) control-polygon box.
 *
 * This is *the* flattening tolerance. It is relative to the curve's own size,
 * so a curve twice as large gets a tolerance twice as large and comes out with
 * roughly the same number of segments — the count depends on the curve's shape,
 * not on its scale, and never on the board's units.
 */
export function calculateBezierSegmentationThreshold(aCoords: number[], aOffset: number): number {
  const minimum = calculateBezierBoundingBoxExtremity(aCoords, aOffset, Math.min);
  const maximum = calculateBezierBoundingBoxExtremity(aCoords, aOffset, Math.max);
  const boundingBoxDimensions = { x: maximum.x - minimum.x, y: maximum.y - minimum.y };

  return 0.001 * Math.max(boundingBoxDimensions.x, boundingBoxDimensions.y);
}

/**
 * `distanceFromPointToLine`: the perpendicular distance from `aPoint` to the
 * infinite line through `aLineStart` and `aLineEnd`.
 *
 * The degenerate case is an explicit upstream fix, kept with its reasoning:
 * when the two line points coincide, `Perpendicular().Resize(1)` of the zero
 * vector is still zero, the dot product is always zero, and a Bézier whose
 * start and end are the same point — a single-node closed curve — would never
 * subdivide at all. Falling back to the point-to-point distance makes it.
 */
export function distanceFromPointToLine(aPoint: Vec2, aLineStart: Vec2, aLineEnd: Vec2): number {
  const lineDirection = { x: aLineEnd.x - aLineStart.x, y: aLineEnd.y - aLineStart.y };

  if (lineDirection.x === 0.0 && lineDirection.y === 0.0)
    return Math.hypot(aPoint.x - aLineStart.x, aPoint.y - aLineStart.y);

  // VECTOR2::Perpendicular() is ( y, -x ); Resize( 1 ) makes it a unit vector.
  const norm = Math.hypot(lineDirection.x, lineDirection.y);
  const lineNormal = { x: lineDirection.y / norm, y: -lineDirection.x / norm };
  const lineStartToPoint = { x: aPoint.x - aLineStart.x, y: aPoint.y - aLineStart.y };

  const distance = lineNormal.x * lineStartToPoint.x + lineNormal.y * lineStartToPoint.y;

  return Math.abs(distance);
}

/**
 * `segmentBezierCurve` and `createNewBezierCurveSegments`, the subdivision rule.
 *
 * Recursive midpoint subdivision **in parameter space**: sample the curve at
 * `offset + step`, and if that sample lies further than `threshold` from the
 * chord joining the interval's ends, recurse into both halves with the step
 * halved, emitting the sample between them. The recursion runs in order, so the
 * points come out sorted by parameter, and it terminates because each level
 * halves the parameter interval and a short enough interval is flat to within
 * any positive tolerance.
 *
 * Note what it is *not*: there is no fixed segment count, no arc-length
 * criterion and no depth limit. The number of segments a curve becomes is
 * decided entirely by `threshold` (one thousandth of the control box) and by
 * how far the curve bows away from its chords.
 *
 * Two consequences are pinned by tests rather than fixed. Halving the step is
 * what puts the samples on a **dyadic grid** — a curve that needs five levels
 * comes out as the curve evaluated at exactly k/32 — so the divisor is not a
 * free tuning knob. And because each interval is judged by **one** sample, a
 * cubic that crosses its chord at that sample is declared flat: the S-curve
 * `(0,0) (10,0) (0,10) (10,10)` passes through the midpoint of its own chord
 * and is imported as a straight line.
 */
function segmentBezierCurve(
  aStart: Vec2,
  aEnd: Vec2,
  aOffset: number,
  aStep: number,
  aCoords: number[],
  aCoordOffset: number,
  aSegmentationThreshold: number,
  aGeneratedPoints: Vec2[],
): void {
  const middle = getBezierPoint(aCoords, aCoordOffset, aOffset + aStep);
  const distanceToPreviousSegment = distanceFromPointToLine(middle, aStart, aEnd);

  if (distanceToPreviousSegment > aSegmentationThreshold) {
    const newStep = aStep / 2.0;
    const offsetAfterMiddle = aOffset + aStep;

    segmentBezierCurve(
      aStart,
      middle,
      aOffset,
      newStep,
      aCoords,
      aCoordOffset,
      aSegmentationThreshold,
      aGeneratedPoints,
    );

    aGeneratedPoints.push(middle);

    segmentBezierCurve(
      middle,
      aEnd,
      offsetAfterMiddle,
      newStep,
      aCoords,
      aCoordOffset,
      aSegmentationThreshold,
      aGeneratedPoints,
    );
  }
}

/**
 * `GatherInterpolatedCubicBezierCurve`: flatten one cubic into `aGeneratedPoints`.
 *
 * The start point is appended only when it is not already the last point
 * gathered, which is what keeps a path's curves from doubling up their shared
 * knots; the end point is always appended.
 */
export function GatherInterpolatedCubicBezierCurve(
  aCoords: number[],
  aOffset: number,
  aGeneratedPoints: Vec2[],
): void {
  const start = getBezierPoint(aCoords, aOffset, 0.0);
  const end = getBezierPoint(aCoords, aOffset, 1.0);
  const segmentationThreshold = calculateBezierSegmentationThreshold(aCoords, aOffset);

  const back = aGeneratedPoints[aGeneratedPoints.length - 1];

  if (aGeneratedPoints.length === 0 || back!.x !== start.x || back!.y !== start.y)
    aGeneratedPoints.push(start);

  segmentBezierCurve(
    start,
    end,
    0.0,
    0.5,
    aCoords,
    aOffset,
    segmentationThreshold,
    aGeneratedPoints,
  );

  aGeneratedPoints.push(end);
}

/**
 * `GatherInterpolatedCubicBezierPath`: walk nanosvg's point array four points
 * at a time, advancing by three (six floats) so that consecutive curves share
 * a knot.
 */
export function GatherInterpolatedCubicBezierPath(
  aCoords: number[],
  aNumPoints: number,
  aGeneratedPoints: Vec2[],
): void {
  const pointsPerSegment = 4;
  const curveSpecificPointsPerSegment = 3;
  const curveSpecificCoordinatesPerSegment = 2 * curveSpecificPointsPerSegment;

  let offset = 0;
  let remainingPoints = aNumPoints;

  while (remainingPoints >= pointsPerSegment) {
    GatherInterpolatedCubicBezierCurve(aCoords, offset, aGeneratedPoints);
    offset += curveSpecificCoordinatesPerSegment;
    remainingPoints -= curveSpecificPointsPerSegment;
  }
}

/**
 * `SVG_IMPORT_PLUGIN`.
 *
 * Upstream derives from `GRAPHICS_IMPORT_PLUGIN` and shares that base with the
 * DXF plugin. No base class is introduced here: the two plugins have nothing in
 * common beyond a method list, and a shared abstraction invented on one side
 * would have to be guessed at on the other.
 */
export class SVG_IMPORT_PLUGIN {
  private m_parsedImage: NSVGimage | null = null;
  /** Messages about entities that could not be imported; each ends in '\n'. */
  private m_messages = '';
  private m_internalImporter = new GRAPHICS_IMPORTER_BUFFER();
  private m_importer: GRAPHICS_IMPORTER | null = null;

  GetName(): string {
    return 'Scalable Vector Graphics';
  }

  GetFileExtensions(): string[] {
    return ['svg'];
  }

  GetMessages(): string {
    return this.m_messages;
  }

  ReportMsg(aMessage: string): void {
    // Add message to keep trace of not handled svg entities
    this.m_messages += aMessage;
    this.m_messages += '\n';
  }

  SetImporter(aImporter: GRAPHICS_IMPORTER): void {
    this.m_importer = aImporter;
  }

  /**
   * `LoadFromMemory`. Upstream also has `Load( fileName )`, which is the same
   * thing after `wxFopen` — reading the file is the caller's job here, so the
   * two collapse into one. `LOCALE_IO` has no counterpart either: nanosvg
   * rolls its own locale-independent number parsing.
   */
  LoadFromMemory(aContents: string): boolean {
    if (!this.m_importer) return false;

    this.m_parsedImage = nsvgParse(aContents, 'mm', SVG_DPI);

    return this.m_parsedImage !== null;
  }

  /** Same as {@link LoadFromMemory}; kept for the upstream call shape. */
  Load(aContents: string): boolean {
    return this.LoadFromMemory(aContents);
  }

  /** The buffer the shape walk fills, exposed for tests. */
  GetInternalImporter(): GRAPHICS_IMPORTER_BUFFER {
    return this.m_internalImporter;
  }

  /**
   * `Import`: walk the parsed shapes, feed the internal buffer, then replay the
   * buffer into the real importer.
   *
   * The guard on `m_parsedImage` has no upstream counterpart — `Import` without
   * a preceding `Load` dereferences a null `NSVGimage` there. Returning false
   * is the only sane translation of a segfault.
   */
  Import(): boolean {
    if (!this.m_parsedImage) return false;

    /** `alpha( color )` — the top byte, which nanosvg filled from the opacity. */
    const alpha = (color: number): number => color >>> 24;

    for (const shape of this.m_parsedImage.shapes) {
      if (!(shape.flags & NSVG_FLAGS_VISIBLE)) continue;

      if (
        shape.stroke.type === NSVGpaintType.NSVG_PAINT_NONE &&
        shape.fill.type === NSVGpaintType.NSVG_PAINT_NONE
      )
        continue;

      // -1 is the importer's "no stroke at all", not "default width".
      const lineWidth =
        shape.stroke.type !== NSVGpaintType.NSVG_PAINT_NONE ? shape.strokeWidth : -1;
      const filled =
        shape.fill.type !== NSVGpaintType.NSVG_PAINT_NONE && alpha(shape.fill.color) > 0;

      let fillColor: Color4d = COLOR4D_UNSPECIFIED;

      if (shape.fill.type === NSVGpaintType.NSVG_PAINT_COLOR) {
        const icolor = shape.fill.color;

        fillColor = {
          r: channel(icolor, 0),
          g: channel(icolor, 8),
          b: channel(icolor, 16),
          a: channel(icolor, 24),
        };

        // nanosvg probably didn't read it properly, use default
        if (colorEquals(fillColor, COLOR4D_BLACK)) fillColor = COLOR4D_UNSPECIFIED;
      }

      let strokeColor: Color4d = COLOR4D_UNSPECIFIED;

      if (shape.stroke.type === NSVGpaintType.NSVG_PAINT_COLOR) {
        const icolor = shape.stroke.color;

        strokeColor = {
          r: channel(icolor, 0),
          g: channel(icolor, 8),
          b: channel(icolor, 16),
          a: channel(icolor, 24),
        };

        // nanosvg probably didn't read it properly, use default
        if (colorEquals(strokeColor, COLOR4D_BLACK)) strokeColor = COLOR4D_UNSPECIFIED;
      }

      let dashType = LINE_STYLE.SOLID;

      if (shape.strokeDashCount > 0) {
        const dashArray = shape.strokeDashArray;

        let dotCount = 0;
        let dashCount = 0;

        const dashThreshold = shape.strokeWidth * 1.9;

        // `i += 2` — only the dashes are classified, never the gaps.
        for (let i = 0; i < shape.strokeDashCount; i += 2) {
          if (dashArray[i]! < dashThreshold) dotCount++;
          else dashCount++;
        }

        if (dotCount > 0 && dashCount === 0) dashType = LINE_STYLE.DOT;
        else if (dotCount === 0 && dashCount > 0) dashType = LINE_STYLE.DASH;
        else if (dotCount === 1 && dashCount === 1) dashType = LINE_STYLE.DASHDOT;
        else if (dotCount === 2 && dashCount === 1) dashType = LINE_STYLE.DASHDOTDOT;
      }

      const stroke = new IMPORTED_STROKE(lineWidth, dashType, strokeColor);

      let rule = POLY_FILL_RULE.PF_NONZERO;

      switch (shape.fillRule) {
        case NSVGfillRule.NSVG_FILLRULE_NONZERO:
          rule = POLY_FILL_RULE.PF_NONZERO;
          break;
        case NSVGfillRule.NSVG_FILLRULE_EVENODD:
          rule = POLY_FILL_RULE.PF_EVEN_ODD;
          break;
        default:
          break;
      }

      this.m_internalImporter.NewShape(rule);

      for (const path of shape.paths) {
        if (filled && !path.closed) {
          // KiCad doesn't support a single object representing a filled shape
          // that is *not* closed so create a filled, closed shape for the fill,
          // and an unfilled, open shape for the outline
          const noStroke = new IMPORTED_STROKE(-1, LINE_STYLE.SOLID, COLOR4D_UNSPECIFIED);
          const closed = true;

          this.DrawPath(path.pts, path.npts, closed, noStroke, true, fillColor);

          if (stroke.GetWidth() > 0)
            this.DrawPath(path.pts, path.npts, !closed, stroke, false, COLOR4D_UNSPECIFIED);
        } else {
          // Either the shape has fill and no stroke, so we implicitly close it
          // (for no difference), or it's really closed.
          // We could choose to import a not-filled, closed outline as splines to
          // keep the original editability and control points, but currently we
          // don't.
          const closed = path.closed || filled;

          this.DrawPath(path.pts, path.npts, closed, stroke, filled, fillColor);
        }
      }
    }

    this.m_internalImporter.PostprocessNestedPolygons();

    if (!this.m_importer) return false;

    this.m_internalImporter.ImportTo(this.m_importer);

    return true;
  }

  /** `image->height / SVG_DPI * inches2mm`. */
  GetImageHeight(): number {
    if (!this.m_parsedImage) return 0.0;

    return (this.m_parsedImage.height / SVG_DPI) * inches2mm;
  }

  /** `image->width / SVG_DPI * inches2mm`. */
  GetImageWidth(): number {
    if (!this.m_parsedImage) return 0.0;

    return (this.m_parsedImage.width / SVG_DPI) * inches2mm;
  }

  /**
   * `GetImageBBox`: the union of every shape's own bounds.
   *
   * These are already millimetres — `scaleToViewbox` folded the unit scale into
   * every shape's bounds but not into `image->width`/`height`, which stay in
   * user units. So this method converts nothing while `GetImageWidth` divides
   * by the DPI and multiplies by 25.4; both end in millimetres by two
   * different routes.
   */
  GetImageBBox(): BOX2D {
    const bbox = new BOX2D();

    if (!this.m_parsedImage || this.m_parsedImage.shapes.length === 0) return bbox;

    for (const shape of this.m_parsedImage.shapes) {
      const shapeBbox = new BOX2D();

      shapeBbox.SetOrigin(shape.bounds[0], shape.bounds[1]);
      shapeBbox.SetEnd(shape.bounds[2], shape.bounds[3]);

      bbox.MergeBox(shapeBbox);
    }

    return bbox;
  }

  /**
   * `DrawPath`. A closed path is interpolated into a polygon; anything else —
   * including a closed path that interpolated to two points or fewer — falls
   * through to the spline route with its control points intact.
   */
  private DrawPath(
    aPoints: number[],
    aNumPoints: number,
    aClosedPath: boolean,
    aStroke: IMPORTED_STROKE,
    aFilled: boolean,
    aFillColor: Color4d,
  ): void {
    let drewPolygon = false;

    if (aClosedPath) {
      // Closed paths are always polygons, which mean they need to be interpolated
      const collectedPathPoints: Vec2[] = [];

      if (aNumPoints > 0)
        GatherInterpolatedCubicBezierPath(aPoints, aNumPoints, collectedPathPoints);

      if (collectedPathPoints.length > 2) {
        this.DrawPolygon(collectedPathPoints, aStroke, aFilled, aFillColor);
        drewPolygon = true;
      }
    }

    if (!drewPolygon) this.DrawSplinePath(aPoints, aNumPoints, aStroke);
  }

  /**
   * `DrawSplinePath`. nanosvg only hands back Bézier control points, so the
   * decision of whether a given cubic is really a straight segment is deferred
   * to the importer's `setupSplineOrLine`.
   */
  private DrawSplinePath(aCoords: number[], aNumPoints: number, aStroke: IMPORTED_STROKE): void {
    const pointsPerSegment = 4;
    const curveSpecificPointsPerSegment = 3;
    const curveSpecificCoordinatesPerSegment = 2 * curveSpecificPointsPerSegment;

    let offset = 0;
    let remainingPoints = aNumPoints;

    while (remainingPoints >= pointsPerSegment) {
      const start = getPoint(aCoords, offset);
      const c1 = getPoint(aCoords, offset + 2);
      const c2 = getPoint(aCoords, offset + 4);
      const end = getPoint(aCoords, offset + 6);

      this.m_internalImporter.AddSpline(start, c1, c2, end, aStroke);

      offset += curveSpecificCoordinatesPerSegment;
      remainingPoints -= curveSpecificPointsPerSegment;
    }
  }

  private DrawPolygon(
    aPoints: Vec2[],
    aStroke: IMPORTED_STROKE,
    aFilled: boolean,
    aFillColor: Color4d,
  ): void {
    this.m_internalImporter.AddPolygon(aPoints, aStroke, aFilled, aFillColor);
  }

  /**
   * `DrawLineSegments`. **Dead code upstream** — nothing in the plugin calls
   * it, and has not since the spline path replaced it. Ported because it is a
   * member of the class, and left uncalled for the same reason.
   */
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: dead upstream too
  private DrawLineSegments(aPoints: Vec2[], aStroke: IMPORTED_STROKE): void {
    const numLineStartPoints = aPoints.length - 1;

    for (let pointIndex = 0; pointIndex < numLineStartPoints; ++pointIndex)
      this.m_internalImporter.AddLine(aPoints[pointIndex]!, aPoints[pointIndex + 1]!, aStroke);
  }
}
