// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/am_primitive.h` + `.cpp`: one primitive of an aperture macro —
 * circle, vector line, centre line, lower-left line, outline, polygon, moiré,
 * thermal — and its conversion to a polygon.
 *
 * "Each basic shape can be a positive shape or a negative shape. A negative
 * shape is local to the whole shape: it must be seen like a hole in the shape,
 * and not like a standard negative object."
 *
 * "Rotation of primitives inside a macro must be always done around the macro
 * origin."
 */
import {
  ANGLE_0,
  ANGLE_90,
  ANGLE_360,
  EDA_ANGLE,
  EDA_ANGLE_T,
} from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { EuclideanNorm, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import {
  ErrorLoc,
  transformCircleToPolygonSet,
  transformRingToPolygon,
} from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import type { AM_PARAMS } from './am_param.js';
import type { APERTURE_MACRO } from './aperture_macro.js';
import { IU_PER_MM } from './gerbview.js';
import { scaletoIU } from './rs274_read_XY_and_IJ_coordinates.js';

/**
 * `AM_PRIMITIVE_ID`: the aperture macro primitive numbers (Table 3 of the
 * RS-274X spec).
 */
export enum AM_PRIMITIVE_ID {
  /** A value for uninitialized AM_PRIMITIVE. */
  AMP_UNKNOWN = -1,
  /** Not really a primitive: a comment. */
  AMP_COMMENT = 0,
  /** Circle (diameter and position). */
  AMP_CIRCLE = 1,
  /** Line with rectangle ends (width, start and end pos + rotation). */
  AMP_LINE2 = 2,
  /** Same as AMP_LINE2. */
  AMP_LINE20 = 20,
  /** Rectangle (height, width and center pos + rotation). */
  AMP_LINE_CENTER = 21,
  /** Rectangle (height, width and left bottom corner pos + rotation). */
  AMP_LINE_LOWER_LEFT = 22,
  /** Free polyline (n corners + rotation). */
  AMP_OUTLINE = 4,
  /** Closed regular polygon (diameter, number of vertices (3 to 10), rotation). */
  AMP_POLYGON = 5,
  /** A cross hair with n concentric circles + rotation (deprecated in 2021). */
  AMP_MOIRE = 6,
  /** Thermal shape (pos, outer and inner diameter, cross hair thickness + rotation). */
  AMP_THERMAL = 7,
}

/**
 * `mapPt`: a point from the aperture macro coordinate system to ours.
 */
function mapPt(x: number, y: number, isMetric: boolean): VECTOR2I {
  return { x: scaletoIU(x, isMetric), y: scaletoIU(y, isMetric) };
}

/** `gerbIUScale.mmToIU( 0.005 )`: "Allow 5 microns". [data] */
const ARC_TO_SEG_ERROR = KiROUND(0.005 * IU_PER_MM);

const add = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: a.x + b.x, y: a.y + b.y });

/** `aShapeBuffer.NewOutline(); Append(...)` for each outline of a ring or disc. */
function appendOutlines(aShapeBuffer: SHAPE_POLY_SET, aOutlines: VECTOR2I[][]): void {
  for (const outline of aOutlines) {
    aShapeBuffer.NewOutline();
    for (const p of outline) aShapeBuffer.Append(p);
  }
}

/** `AM_PRIMITIVE`: an aperture macro primitive as given in the Gerber format doc. */
export class AM_PRIMITIVE {
  /** The primitive type. */
  m_Primitive_id: AM_PRIMITIVE_ID;
  /** A sequence of parameters used by the primitive. */
  m_Params: AM_PARAMS = [];
  /** Units for this primitive: false = Inches, true = metric. */
  m_GerbMetric: boolean;
  /**
   * Count of local params defined inside the aperture macro when this
   * primitive was put in its primitive list.
   */
  m_LocalParamLevel: number;

  constructor(aGerbMetric: boolean, aId: AM_PRIMITIVE_ID = AM_PRIMITIVE_ID.AMP_UNKNOWN) {
    this.m_Primitive_id = aId;
    this.m_GerbMetric = aGerbMetric;
    this.m_LocalParamLevel = 0;
  }

  /** The value copy `AddPrimitiveToList` pushes (`push_back( aPrimitive )`). */
  Clone(): AM_PRIMITIVE {
    const c = new AM_PRIMITIVE(this.m_GerbMetric, this.m_Primitive_id);
    c.m_Params = this.m_Params.slice();
    c.m_LocalParamLevel = this.m_LocalParamLevel;
    return c;
  }

  /** `m_Params[ii].GetValueFromMacro( aApertMacro )`. */
  private prm(ii: number, aApertMacro: APERTURE_MACRO | null): number {
    // An out-of-range std::vector::operator[] is undefined behaviour upstream;
    // a missing parameter reads as 0.
    return this.m_Params[ii]?.GetValueFromMacro(aApertMacro) ?? 0;
  }

  /**
   * True if the first parameter is not 0 (it can be only 0 or 1). "Some but
   * not all primitives use the first parameter as an exposure control. Others
   * are always ON."
   */
  IsAMPrimitiveExposureOn(aApertMacro: APERTURE_MACRO | null): boolean {
    switch (this.m_Primitive_id) {
      case AM_PRIMITIVE_ID.AMP_CIRCLE:
      case AM_PRIMITIVE_ID.AMP_LINE2:
      case AM_PRIMITIVE_ID.AMP_LINE20:
      case AM_PRIMITIVE_ID.AMP_LINE_CENTER:
      case AM_PRIMITIVE_ID.AMP_LINE_LOWER_LEFT:
      case AM_PRIMITIVE_ID.AMP_OUTLINE:
      case AM_PRIMITIVE_ID.AMP_POLYGON:
        // All have an exposure parameter and can return a value (0 or 1)
        return this.prm(0, aApertMacro) !== 0;

      default:
        // AMP_THERMAL, AMP_MOIRE, AMP_UNKNOWN: exposure is always on
        return true;
    }
  }

  /**
   * Generate the polygonal shape of the primitive shape of an aperture macro
   * instance, appended to `aShapeBuffer`.
   */
  ConvertBasicShapeToPolygon(aApertMacro: APERTURE_MACRO, aShapeBuffer: SHAPE_POLY_SET): void {
    // Draw the primitive shape for flashed items.
    // Note: rotation of primitives inside a macro must be always done around the macro origin.
    let polybuffer: VECTOR2I[] = [];

    aApertMacro.EvalLocalParams(this);

    switch (this.m_Primitive_id) {
      case AM_PRIMITIVE_ID.AMP_CIRCLE: {
        // Circle, given diameter and position
        /* type (1), exposure, diameter, pos.x, pos.y, <rotation>
         * <rotation> is a optional parameter: rotation from origin. */
        this.ConvertShapeToPolygon(aApertMacro, polybuffer);

        // shape rotation (if any):
        if (this.m_Params.length >= 5) {
          const rotation = new EDA_ANGLE(this.prm(4, aApertMacro), EDA_ANGLE_T.DEGREES_T);

          if (!rotation.IsZero()) {
            for (let ii = 0; ii < polybuffer.length; ii++)
              polybuffer[ii] = RotatePoint(polybuffer[ii] as VECTOR2I, rotation.negate());
          }
        }

        break;
      }

      case AM_PRIMITIVE_ID.AMP_LINE2:
      case AM_PRIMITIVE_ID.AMP_LINE20: {
        // Line with rectangle ends. (Width, start and end pos + rotation)
        /* type (2), exposure, width, start.x, start.y, end.x, end.y, rotation */
        this.ConvertShapeToPolygon(aApertMacro, polybuffer);

        // shape rotation:
        const rotation = new EDA_ANGLE(this.prm(6, aApertMacro), EDA_ANGLE_T.DEGREES_T);

        if (!rotation.IsZero()) {
          for (let ii = 0; ii < polybuffer.length; ii++)
            polybuffer[ii] = RotatePoint(polybuffer[ii] as VECTOR2I, rotation.negate());
        }

        break;
      }

      case AM_PRIMITIVE_ID.AMP_LINE_CENTER: {
        /* Center Line, Primitive Code 21: a rectangle defined by its width,
         * height, and center point.
         * type (21), exposure, width, height, center pos.x, center pos.y, rotation */
        this.ConvertShapeToPolygon(aApertMacro, polybuffer);

        // shape rotation:
        const rotation = new EDA_ANGLE(this.prm(5, aApertMacro), EDA_ANGLE_T.DEGREES_T);

        if (!rotation.IsZero()) {
          for (let ii = 0; ii < polybuffer.length; ii++)
            polybuffer[ii] = RotatePoint(polybuffer[ii] as VECTOR2I, rotation.negate());
        }

        break;
      }

      case AM_PRIMITIVE_ID.AMP_LINE_LOWER_LEFT: {
        /* type (22), exposure, width, height, corner pos.x, corner pos.y, rotation */
        this.ConvertShapeToPolygon(aApertMacro, polybuffer);

        // shape rotation:
        const rotation = new EDA_ANGLE(this.prm(5, aApertMacro), EDA_ANGLE_T.DEGREES_T);

        if (!rotation.IsZero()) {
          for (let ii = 0; ii < polybuffer.length; ii++)
            polybuffer[ii] = RotatePoint(polybuffer[ii] as VECTOR2I, rotation.negate());
        }
        break;
      }

      case AM_PRIMITIVE_ID.AMP_THERMAL: {
        /* type (7), center.x , center.y, outside diam, inside diam, crosshair thickness, rotation
         * The thermal primitive is a ring (annulus) interrupted by four gaps.
         * Exposure is always on. */
        const subshape_poly: VECTOR2I[] = [];
        const center = mapPt(this.prm(0, aApertMacro), this.prm(1, aApertMacro), this.m_GerbMetric);
        this.ConvertShapeToPolygon(aApertMacro, subshape_poly);

        // shape rotation:
        const rotation = new EDA_ANGLE(this.prm(5, aApertMacro), EDA_ANGLE_T.DEGREES_T);

        // Because a thermal shape has 4 identical sub-shapes, only one is created in
        // subshape_poly. We must draw 4 sub-shapes rotated by 90 deg
        for (let ii = 0; ii < 4; ii++) {
          polybuffer = subshape_poly.slice();
          const sub_rotation = ANGLE_90.multiply(ii);

          for (let jj = 0; jj < polybuffer.length; jj++)
            polybuffer[jj] = RotatePoint(polybuffer[jj] as VECTOR2I, sub_rotation.negate());

          // Move to center position given by the tool, and rotate the full shape around
          // the center position (origin of the macro):
          for (let jj = 0; jj < polybuffer.length; jj++) {
            polybuffer[jj] = add(polybuffer[jj] as VECTOR2I, center);
            polybuffer[jj] = RotatePoint(polybuffer[jj] as VECTOR2I, rotation.negate());
          }

          aShapeBuffer.NewOutline();

          for (let jj = 0; jj < polybuffer.length; jj++)
            aShapeBuffer.Append(polybuffer[jj] as VECTOR2I);

          aShapeBuffer.Append(polybuffer[0] as VECTOR2I);
        }

        // `polybuffer` still holds the last sub-shape, and the common tail below
        // appends it once more, exactly as upstream does.
        break;
      }

      case AM_PRIMITIVE_ID.AMP_MOIRE: {
        /* Moire, Primitive Code 6: a cross hair centered on concentric rings.
         * type(6), pos.x, pos.y, diam, penwidth, gap, circlecount, crosshair thickness,
         * crosshair len, rotation. Exposure is always on. */
        let outerDiam = scaletoIU(this.prm(2, aApertMacro), this.m_GerbMetric);
        const penThickness = scaletoIU(this.prm(3, aApertMacro), this.m_GerbMetric);
        const gap = scaletoIU(this.prm(4, aApertMacro), this.m_GerbMetric);
        const numCircles = KiROUND(this.prm(5, aApertMacro));

        // Adjust the allowed approx error to convert arcs to segments:
        const arc_to_seg_error = ARC_TO_SEG_ERROR; // Allow 5 microns

        // Draw circles @ position pos.x, pos.y given by the tool:
        const center = mapPt(this.prm(0, aApertMacro), this.prm(1, aApertMacro), this.m_GerbMetric);

        const rotation = new EDA_ANGLE(this.prm(8, aApertMacro), EDA_ANGLE_T.DEGREES_T);

        // adjust outerDiam by this on each nested circle
        const diamAdjust = (gap + penThickness) * 2;

        for (let i = 0; i < numCircles; ++i, outerDiam -= diamAdjust) {
          if (outerDiam <= 0) break;

          // calculate the rotated position of the center:
          const circle_center = RotatePoint(center, rotation.negate());

          // Note: outerDiam is the outer diameter of the ring.
          // the ring graphic diameter is (outerDiam - penThickness)
          if (outerDiam <= penThickness) {
            // No room to draw a ring (no room for the hole):
            // draw a circle instead (with no hole), with the right diameter
            appendOutlines(aShapeBuffer, [
              transformCircleToPolygonSet(
                circle_center,
                Math.trunc(outerDiam / 2),
                arc_to_seg_error,
                ErrorLoc.ERROR_INSIDE,
              ),
            ]);
          } else {
            appendOutlines(
              aShapeBuffer,
              transformRingToPolygon(
                circle_center,
                Math.trunc((outerDiam - penThickness) / 2),
                penThickness,
                arc_to_seg_error,
                ErrorLoc.ERROR_INSIDE,
              ),
            );
          }
        }

        // Draw the cross:
        this.ConvertShapeToPolygon(aApertMacro, polybuffer);

        for (let ii = 0; ii < polybuffer.length; ii++) {
          // move crossair shape to center and rotate shape:
          polybuffer[ii] = add(polybuffer[ii] as VECTOR2I, center);
          polybuffer[ii] = RotatePoint(polybuffer[ii] as VECTOR2I, rotation.negate());
        }

        break;
      }

      case AM_PRIMITIVE_ID.AMP_OUTLINE: {
        /* Outline, Primitive Code 4: an area enclosed by an n-point polygon
         * defined by its start point and n subsequent points.
         * type(4), exposure, corners count, corner1.x, corner.1y, ..., rotation */
        // m_Params[0] is the exposure and m_Params[1] is the corners count after the first corner
        const numCorners = Math.trunc(this.prm(1, aApertMacro));

        // the shape rotation is the last param of list, after corners
        const last_prm = this.m_Params.length - 1;
        const rotation = new EDA_ANGLE(this.prm(last_prm, aApertMacro), EDA_ANGLE_T.DEGREES_T);
        const pos: VECTOR2I = { x: 0, y: 0 };

        // Read points.
        // Note: numCorners is the polygon corner count, following the first corner
        // * the polygon is always closed,
        // * therefore the last XY coordinate is the same as the first
        let prm_idx = 2; //  m_Params[2] is the first X coordinate

        for (let i = 0; i <= numCorners; ++i) {
          pos.x = scaletoIU(this.prm(prm_idx, aApertMacro), this.m_GerbMetric);
          prm_idx++;
          pos.y = scaletoIU(this.prm(prm_idx, aApertMacro), this.m_GerbMetric);
          prm_idx++;
          polybuffer.push({ ...pos });

          // Guard: ensure prm_idx < last_prm
          // I saw malformed gerber files with numCorners = number
          // of coordinates instead of number of coordinates following the first point
          if (prm_idx >= last_prm) break;
        }

        // rotate polygon and move it to the actual position shape rotation:
        for (let ii = 0; ii < polybuffer.length; ii++)
          polybuffer[ii] = RotatePoint(polybuffer[ii] as VECTOR2I, rotation.negate());

        break;
      }

      case AM_PRIMITIVE_ID.AMP_POLYGON: {
        /* Polygon, Primitive Code 5: a regular polygon defined by the number of
         * vertices n, the center point and the diameter of the circumscribed circle.
         * type(5), exposure, vertices count, pox.x, pos.y, diameter, rotation */
        const curPos = mapPt(this.prm(2, aApertMacro), this.prm(3, aApertMacro), this.m_GerbMetric);

        // Creates the shape:
        this.ConvertShapeToPolygon(aApertMacro, polybuffer);

        // move and rotate polygonal shape
        const rotation = new EDA_ANGLE(this.prm(5, aApertMacro), EDA_ANGLE_T.DEGREES_T);

        for (let ii = 0; ii < polybuffer.length; ii++) {
          polybuffer[ii] = add(polybuffer[ii] as VECTOR2I, curPos);
          polybuffer[ii] = RotatePoint(polybuffer[ii] as VECTOR2I, rotation.negate());
        }

        break;
      }

      default:
        // AMP_COMMENT, AMP_UNKNOWN
        break;
    }

    if (polybuffer.length > 1) {
      // a valid polygon has more than 1 corner
      aShapeBuffer.NewOutline();

      for (let jj = 0; jj < polybuffer.length; jj++)
        aShapeBuffer.Append(polybuffer[jj] as VECTOR2I);

      // Close the shape:
      aShapeBuffer.Append(polybuffer[0] as VECTOR2I);
    }
  }

  /**
   * Convert a shape to an equivalent polygon, appended to `aBuffer`. Arcs and
   * circles are approximated by segments.
   */
  private ConvertShapeToPolygon(aApertMacro: APERTURE_MACRO, aBuffer: VECTOR2I[]): void {
    switch (this.m_Primitive_id) {
      case AM_PRIMITIVE_ID.AMP_CIRCLE: {
        /* type (1), exposure, diameter, pos.x, pos.y, <rotation> */
        const radius = Math.trunc(scaletoIU(this.prm(1, aApertMacro), this.m_GerbMetric) / 2);

        // A circle primitive can have a 0 size (for instance when used in roundrect macro),
        // so skip it
        if (radius <= 0) break;

        const center = mapPt(this.prm(2, aApertMacro), this.prm(3, aApertMacro), this.m_GerbMetric);

        const seg_per_circle = 64; // Number of segments to approximate a circle
        const delta = ANGLE_360.divide(seg_per_circle);

        for (let angle = ANGLE_0; angle.lt(ANGLE_360); angle = angle.add(delta)) {
          const corner = RotatePoint({ x: radius, y: 0 }, angle);
          aBuffer.push(add(corner, center));
        }

        break;
      }

      case AM_PRIMITIVE_ID.AMP_LINE2:
      case AM_PRIMITIVE_ID.AMP_LINE20: {
        // Line with rectangle ends. (Width, start and end pos + rotation)
        const width = scaletoIU(this.prm(1, aApertMacro), this.m_GerbMetric);
        const start = mapPt(this.prm(2, aApertMacro), this.prm(3, aApertMacro), this.m_GerbMetric);
        const end = mapPt(this.prm(4, aApertMacro), this.prm(5, aApertMacro), this.m_GerbMetric);
        const delta = { x: end.x - start.x, y: end.y - start.y };
        // `int len = delta.EuclideanNorm();` - VECTOR2I's, KiROUND'd.
        const len = KiROUND(EuclideanNorm(delta));

        // To build the polygon, we must create a horizontal polygon starting to "start"
        // and rotate it to have the end point to "end"
        const currpt: VECTOR2I = { x: 0, y: 0 };
        currpt.y += Math.trunc(width / 2); // Upper left
        aBuffer.push({ ...currpt });
        currpt.x = len; // Upper right
        aBuffer.push({ ...currpt });
        currpt.y -= width; // lower right
        aBuffer.push({ ...currpt });
        currpt.x = 0; // lower left
        aBuffer.push({ ...currpt });

        // Rotate rectangle and move it to the actual start point
        const angle = EDA_ANGLE.fromVector(delta);

        // `aBuffer[ii]` for ii in 0..3: the buffer arrives empty (the caller
        // clears it), so these are the four corners just pushed.
        for (let ii = 0; ii < 4; ii++)
          aBuffer[ii] = add(RotatePoint(aBuffer[ii] as VECTOR2I, angle.negate()), start);

        break;
      }

      case AM_PRIMITIVE_ID.AMP_LINE_CENTER: {
        const size = mapPt(this.prm(1, aApertMacro), this.prm(2, aApertMacro), this.m_GerbMetric);
        const pos = mapPt(this.prm(3, aApertMacro), this.prm(4, aApertMacro), this.m_GerbMetric);

        // Build poly:
        pos.x -= Math.trunc(size.x / 2);
        pos.y -= Math.trunc(size.y / 2); // Lower left
        aBuffer.push({ ...pos });
        pos.y += size.y; // Upper left
        aBuffer.push({ ...pos });
        pos.x += size.x; // Upper right
        aBuffer.push({ ...pos });
        pos.y -= size.y; // lower right
        aBuffer.push({ ...pos });
        break;
      }

      case AM_PRIMITIVE_ID.AMP_LINE_LOWER_LEFT: {
        const size = mapPt(this.prm(1, aApertMacro), this.prm(2, aApertMacro), this.m_GerbMetric);
        const lowerLeft = mapPt(
          this.prm(3, aApertMacro),
          this.prm(4, aApertMacro),
          this.m_GerbMetric,
        );

        // Build poly:
        aBuffer.push({ ...lowerLeft });
        lowerLeft.y += size.y; // Upper left
        aBuffer.push({ ...lowerLeft });
        lowerLeft.x += size.x; // Upper right
        aBuffer.push({ ...lowerLeft });
        lowerLeft.y -= size.y; // lower right
        aBuffer.push({ ...lowerLeft });
        break;
      }

      case AM_PRIMITIVE_ID.AMP_THERMAL: {
        // Only 1/4 of the full shape is built, because the other 3 shapes will be draw from
        // this first rotated by 90, 180 and 270 deg.
        // m_Params = center.x (unused here), center.y (unused here), outside diam, inside diam,
        // crosshair thickness.
        let outerRadius = Math.trunc(scaletoIU(this.prm(2, aApertMacro), this.m_GerbMetric) / 2);
        let innerRadius = Math.trunc(scaletoIU(this.prm(3, aApertMacro), this.m_GerbMetric) / 2);

        // Safety checks to guarantee no divide-by-zero
        outerRadius = Math.max(1, outerRadius);
        innerRadius = Math.max(1, innerRadius);

        const halfthickness = Math.trunc(
          scaletoIU(this.prm(4, aApertMacro), this.m_GerbMetric) / 2,
        );
        let angle_start = new EDA_ANGLE(
          Math.asin(halfthickness / innerRadius),
          EDA_ANGLE_T.RADIANS_T,
        );

        // Draw shape in the first quadrant (X and Y > 0)
        const startpos: VECTOR2I = { x: 0, y: 0 };

        // Inner arc
        startpos.x = innerRadius;
        let angle_end = ANGLE_90.sub(angle_start);
        const TEN = new EDA_ANGLE(10, EDA_ANGLE_T.DEGREES_T);

        for (let angle = angle_start; angle.lt(angle_end); angle = angle.add(TEN))
          aBuffer.push(RotatePoint(startpos, angle));

        // Last point
        aBuffer.push(RotatePoint(startpos, angle_end));

        // outer arc
        startpos.x = outerRadius;
        startpos.y = 0;
        angle_start = new EDA_ANGLE(Math.asin(halfthickness / outerRadius), EDA_ANGLE_T.RADIANS_T);
        angle_end = ANGLE_90.sub(angle_start);

        // First point, near Y axis, outer arc
        for (let angle = angle_end; angle.gt(angle_start); angle = angle.sub(TEN))
          aBuffer.push(RotatePoint(startpos, angle));

        // last point
        aBuffer.push(RotatePoint(startpos, angle_start));

        aBuffer.push({ ...(aBuffer[0] as VECTOR2I) }); // Close poly
        break;
      }

      case AM_PRIMITIVE_ID.AMP_MOIRE: {
        // A cross hair with n concentric circles. Only the cross is built as
        // polygon because circles can be drawn easily
        const crossHairThickness = scaletoIU(this.prm(6, aApertMacro), this.m_GerbMetric);
        const crossHairLength = scaletoIU(this.prm(7, aApertMacro), this.m_GerbMetric);

        // Create cross. First create 1/4 of the shape.
        // Others point are the same, rotated by 90, 180 and 270 deg
        const pos: VECTOR2I = {
          x: Math.trunc(crossHairThickness / 2),
          y: Math.trunc(crossHairLength / 2),
        };
        aBuffer.push({ ...pos });
        pos.y = Math.trunc(crossHairThickness / 2);
        aBuffer.push({ ...pos });
        pos.x = -Math.trunc(crossHairLength / 2);
        aBuffer.push({ ...pos });
        pos.y = -Math.trunc(crossHairThickness / 2);
        aBuffer.push({ ...pos });

        // Copy the 4 shape, rotated by 90, 180 and 270 deg
        for (let jj = 1; jj <= 3; jj++) {
          for (let ii = 0; ii < 4; ii++)
            aBuffer.push(RotatePoint(aBuffer[ii] as VECTOR2I, ANGLE_90.multiply(jj)));
        }

        break;
      }

      case AM_PRIMITIVE_ID.AMP_OUTLINE:
        // already is a polygon. Do nothing
        break;

      case AM_PRIMITIVE_ID.AMP_POLYGON: {
        // Creates a regular polygon
        let vertexcount = KiROUND(this.prm(1, aApertMacro));
        const radius = Math.trunc(scaletoIU(this.prm(4, aApertMacro), this.m_GerbMetric) / 2);

        // rs274x said: vertex count = 3 ... 10, and the first corner is on the X axis
        if (vertexcount < 3) vertexcount = 3;

        if (vertexcount > 10) vertexcount = 10;

        for (let ii = 0; ii <= vertexcount; ii++)
          aBuffer.push(
            RotatePoint({ x: radius, y: 0 }, ANGLE_360.multiply(ii).divide(vertexcount)),
          );

        break;
      }

      default:
        // AMP_COMMENT, AMP_UNKNOWN
        break;
    }
  }
}
