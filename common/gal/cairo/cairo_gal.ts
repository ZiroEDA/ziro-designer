// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/gal/cairo/cairo_gal.h` + `common/gal/cairo/cairo_gal.cpp`:
 * `KIGFX::CAIRO_GAL_BASE`, the GAL drawn with Cairo, and `KIGFX::CAIRO_GAL`,
 * the one in a window - KiCad's software fallback when OpenGL is not there.
 *
 * Cairo is `cairo_api.ts`, a Canvas 2D context behind Cairo's own function
 * names, so the bodies below are the C++ call for call; what Canvas cannot do
 * as Cairo does is listed there, once.
 *
 * What the window was: `CAIRO_GAL` is a `wxWindow` that renders into a pixel
 * buffer and blits it to a `wxClientDC`. Here the window is the application's
 * canvas ({@link CAIRO_GAL_WINDOW}): the buffer is an offscreen canvas at the
 * CLIENT size, in logical pixels as `GetClientSize()` gives them, and the blit
 * scales it onto the canvas's backing store - which is what GTK does with the
 * blitted bitmap on a HiDPI screen. The mouse and gesture forwarding
 * (`skipMouseEvent`, `skipGestureEvent`) is the panel's, which listens on the
 * same canvas; the wxImage byte shuffle in `EndDrawing` has no counterpart,
 * the canvas holds the pixels.
 */

import { EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { MATRIX3x3D } from '@ziroeda/kimath/src/math/matrix3x3.js';
import { atan2, cos, sin } from '@ziroeda/kimath/src/math/libm.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { EuclideanNorm, type Vec2, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePointD } from '@ziroeda/kimath/src/trigo.js';
import type { BITMAP_BASE } from '../../bitmap_base.js';
import { type Color4d, COLOR4D_BLACK, LEGACY_COLORS } from '../../color4d.js';
import type { GLYPH_LIKE, OUTLINE_GLYPH, STROKE_GLYPH } from '../../font/glyph.js';
import type { KICURSOR } from '../cursors.js';
import { RENDER_TARGET } from '../definitions.js';
import { CROSS_HAIR_MODE, type GAL_DISPLAY_OPTIONS, GRID_STYLE } from '../gal_display_options.js';
import { GAL } from '../graphics_abstraction_layer.js';
import {
  type CANVAS_2D,
  cairo_arc,
  cairo_arc_negative,
  cairo_append_path,
  cairo_close_path,
  cairo_copy_path,
  cairo_create,
  cairo_curve_to,
  cairo_destroy,
  cairo_device_to_user_distance,
  cairo_fill,
  cairo_fill_preserve,
  cairo_format_stride_for_width,
  cairo_format_t,
  cairo_get_operator,
  cairo_identity_matrix,
  cairo_image_surface_create,
  cairo_image_surface_create_for_data,
  cairo_line_cap_t,
  cairo_line_join_t,
  cairo_line_to,
  cairo_matrix_init,
  cairo_matrix_init_identity,
  cairo_matrix_multiply,
  cairo_matrix_new,
  cairo_matrix_rotate,
  cairo_matrix_scale,
  type cairo_matrix_t,
  cairo_matrix_translate,
  cairo_move_to,
  cairo_new_path,
  cairo_new_sub_path,
  cairo_operator_t,
  cairo_paint_with_alpha,
  cairo_path_destroy,
  type cairo_path_t,
  cairo_rectangle,
  cairo_restore,
  cairo_rotate,
  cairo_save,
  cairo_scale,
  cairo_set_fill_rule,
  cairo_set_line_cap,
  cairo_set_line_join,
  cairo_set_line_width,
  cairo_set_matrix,
  cairo_set_operator,
  cairo_set_source_rgba,
  cairo_set_source_surface,
  cairo_stroke,
  cairo_stroke_preserve,
  cairo_surface_destroy,
  cairo_surface_flush,
  cairo_surface_mark_dirty,
  cairo_surface_t,
  cairo_t,
  cairo_translate,
  cairo_fill_rule_t,
} from './cairo_api.js';
import { CAIRO_COMPOSITOR } from './cairo_compositor.js';

const { TARGET_CACHED, TARGET_NONCACHED, TARGET_OVERLAY, TARGET_TEMP } = RENDER_TARGET;

const COLOR4D = (r: number, g: number, b: number, a: number): Color4d => ({ r, g, b, a });

/** `wxALPHA_OPAQUE` / `wxALPHA_TRANSPARENT`. */
const wxALPHA_OPAQUE = 255;

/// Definitions for the command recorder
export enum GRAPHICS_COMMAND {
  CMD_SET_FILL, ///< Enable/disable filling
  CMD_SET_STROKE, ///< Enable/disable stroking
  CMD_SET_FILLCOLOR, ///< Set the fill color
  CMD_SET_STROKECOLOR, ///< Set the stroke color
  CMD_SET_LINE_WIDTH, ///< Set the line width
  CMD_STROKE_PATH, ///< Set the stroke path
  CMD_FILL_PATH, ///< Set the fill path
  //CMD_TRANSFORM,                              ///< Transform the actual context
  CMD_ROTATE, ///< Rotate the context
  CMD_TRANSLATE, ///< Translate the context
  CMD_SCALE, ///< Scale the context
  CMD_SAVE, ///< Save the transformation matrix
  CMD_RESTORE, ///< Restore the transformation matrix
  CMD_CALL_GROUP, ///< Call a group
}

/// Maximum number of arguments for one command
const MAX_CAIRO_ARGUMENTS = 4;

/// Type definition for an graphics group element
export interface GROUP_ELEMENT {
  m_Command: GRAPHICS_COMMAND; ///< Command to execute
  // The C++ `union { DblArg[4]; BoolArg; IntArg }`: no command reads more than one member.
  m_Argument: { DblArg: number[]; BoolArg: boolean; IntArg: number };
  m_CairoPath: cairo_path_t | null; ///< Pointer to a Cairo path
}

function newGroupElement(aCommand: GRAPHICS_COMMAND): GROUP_ELEMENT {
  return {
    m_Command: aCommand,
    m_Argument: {
      DblArg: new Array<number>(MAX_CAIRO_ARGUMENTS).fill(0),
      BoolArg: false,
      IntArg: 0,
    },
    m_CairoPath: null,
  };
}

type GROUP = GROUP_ELEMENT[]; ///< A graphic group type definition

/// `::roundp( double )`: to the centre of the pixel.
function roundpScalar(x: number): number {
  return Math.floor(x + 0.5) + 0.5;
}

/**
 * The Cairo implementation of the graphics abstraction layer.
 *
 * Quote from Wikipedia:
 * " Cairo is a software library used to provide a vector graphics-based, device-independent
 *   API for software developers. It is designed to provide primitives for 2-dimensional
 *   drawing across a number of different backends. "
 *
 * Cairo offers also backends for PostScript and PDF surfaces. So it can be used for printing
 * of KiCad graphics surfaces as well.
 */
export class CAIRO_GAL_BASE extends GAL {
  // Variables for the grouping function
  protected m_isGrouping!: boolean; ///< Is grouping enabled ?
  protected m_isElementAdded!: boolean; ///< Was an graphic element added ?
  protected m_groups!: Map<number, GROUP>; ///< List of graphic groups
  protected m_groupCounter!: number; ///< Counter used for generating group keys
  protected m_currentGroup!: GROUP | null; ///< Currently used group

  protected m_lineWidthInPixels!: number;
  protected m_lineWidthIsOdd!: boolean;

  protected m_cairoWorldScreenMatrix!: cairo_matrix_t; ///< Cairo world to screen transform matrix
  protected m_currentXform!: cairo_matrix_t;
  protected m_currentWorld2Screen!: cairo_matrix_t;
  protected m_currentContext!: cairo_t | null; ///< Currently used Cairo context for drawing
  protected m_context!: cairo_t | null; ///< Cairo image
  protected m_surface!: cairo_surface_t | null; ///< Cairo surface

  /// List of surfaces that were created by painting images, to be cleaned up later
  protected m_imageSurfaces!: cairo_surface_t[];

  protected m_xformStack!: cairo_matrix_t[];

  /// Format used to store pixels
  static readonly GAL_FORMAT = cairo_format_t.CAIRO_FORMAT_ARGB32;

  constructor(aDisplayOptions: GAL_DISPLAY_OPTIONS) {
    super(aDisplayOptions);

    this.m_groups = new Map();
    this.m_imageSurfaces = [];
    this.m_xformStack = [];

    // Initialise grouping
    this.m_isGrouping = false;
    this.m_isElementAdded = false;
    this.m_groupCounter = 0;
    this.m_currentGroup = null;

    this.m_lineWidth = 1.0;
    this.m_lineWidthInPixels = 1.0;
    this.m_lineWidthIsOdd = true;

    // Initialise Cairo state
    this.m_cairoWorldScreenMatrix = cairo_matrix_new();
    cairo_matrix_init_identity(this.m_cairoWorldScreenMatrix);
    this.m_currentContext = null;
    this.m_context = null;
    this.m_surface = null;

    // Grid color settings are different in Cairo and OpenGL
    this.SetGridColor(COLOR4D(0.1, 0.1, 0.1, 0.8));
    this.SetAxesColor(LEGACY_COLORS.BLUE);

    // Avoid uninitialized variables:
    this.m_currentXform = cairo_matrix_new();
    this.m_currentWorld2Screen = cairo_matrix_new();
  }

  /** `~CAIRO_GAL_BASE()`. */
  destroy(): void {
    this.ClearCache();

    if (this.m_surface) cairo_surface_destroy(this.m_surface);

    if (this.m_context) cairo_destroy(this.m_context);

    for (const imageSurface of this.m_imageSurfaces) cairo_surface_destroy(imageSurface);
  }

  override IsCairoEngine(): boolean {
    return true;
  }

  override BeginDrawing(): void {
    this.resetContext();
  }

  override EndDrawing(): void {
    // Force remaining objects to be drawn
    this.Flush();
  }

  protected updateWorldScreenMatrix(): void {
    cairo_matrix_multiply(
      this.m_currentWorld2Screen,
      this.m_currentXform,
      this.m_cairoWorldScreenMatrix,
    );
  }

  // Geometric transforms according to the m_currentWorld2Screen transform matrix:
  protected xform(x: number): number; // scale
  protected xform(x: number, y: number): Vec2; // rotation, scale and offset
  protected xform(aP: Vec2): Vec2; // rotation, scale and offset
  protected xform(a: number | Vec2, y?: number): number | Vec2 {
    const m = this.m_currentWorld2Screen;

    if (typeof a !== 'number') return this.xform(a.x, a.y);

    if (y === undefined) {
      const dx = m.xx * a;
      const dy = m.yx * a;
      return Math.sqrt(dx * dx + dy * dy);
    }

    return { x: m.xx * a + m.xy * y + m.x0, y: m.yx * a + m.yy * y + m.y0 };
  }

  /**
   * Transform according to the rotation from m_currentWorld2Screen transform matrix.
   *
   * @param aAngle is the angle in radians to transform.
   * @return the modified angle.
   */
  protected angle_xform(aAngle: number): number {
    // calculate rotation angle due to the rotation transform
    // and if flipped on X axis.
    let world_rotation = -atan2(this.m_currentWorld2Screen.xy, this.m_currentWorld2Screen.xx);

    // When flipped on X axis, the rotation angle is M_PI - initial angle:
    if (this.IsFlippedX()) world_rotation = Math.PI - world_rotation;

    return (aAngle + world_rotation) % (2.0 * Math.PI); // std::fmod
  }

  /**
   * Transform according to the rotation from m_currentWorld2Screen transform matrix
   * for the start angle and the end angle of an arc.
   *
   * @return the transformed [ aStartAngle, aEndAngle ], the C++'s two in/out parameters.
   */
  protected arc_angles_xform_and_normalize(
    aStartAngle: number,
    aEndAngle: number,
  ): [number, number] {
    // 360 deg arcs have a specific calculation.
    const is_360deg_arc = Math.abs(aEndAngle - aStartAngle) >= 2 * Math.PI;
    let startAngle = aStartAngle;
    let endAngle = aEndAngle;

    // When the view is flipped, the coordinates are flipped by the matrix transform
    // However, arc angles need to be "flipped": the flipped angle is M_PI - initial angle.
    if (this.IsFlippedX()) {
      startAngle = Math.PI - startAngle;
      endAngle = Math.PI - endAngle;
    }

    // Normalize arc angles
    [startAngle, endAngle] = this.normalize(startAngle, endAngle);

    // now rotate arc according to the rotation transform matrix
    // Remark:
    // We call angle_xform() to calculate angles according to the flip/rotation
    // transform and normalize between -2M_PI and +2M_PI.
    // Therefore, if aStartAngle = aEndAngle + 2*n*M_PI, the transform gives
    // aEndAngle = aStartAngle
    // So, if this is the case, force the aEndAngle value to draw a circle.
    const start = this.angle_xform(startAngle);
    let end: number;

    if (is_360deg_arc)
      // arc is a full circle
      end = start + 2 * Math.PI;
    else end = this.angle_xform(endAngle);

    return [start, end];
  }

  protected roundp(v: Vec2): Vec2 {
    if (this.m_lineWidthIsOdd) return { x: roundpScalar(v.x), y: roundpScalar(v.y) };
    else return { x: Math.floor(v.x + 0.5), y: Math.floor(v.y + 0.5) };
  }

  private get cr(): cairo_t {
    return this.m_currentContext!;
  }

  // ---------------
  // Drawing methods
  // ---------------

  override DrawLine(aStartPoint: Vec2, aEndPoint: Vec2): void {
    this.syncLineWidth();

    const p0 = this.roundp(this.xform(aStartPoint));
    const p1 = this.roundp(this.xform(aEndPoint));

    cairo_move_to(this.cr, p0.x, p0.y);
    cairo_line_to(this.cr, p1.x, p1.y);
    this.flushPath();
    this.m_isElementAdded = true;
  }

  protected syncLineWidth(aForceWidth = false, aWidth = 0.0): void {
    let w = Math.floor(this.xform(aForceWidth ? aWidth : this.m_lineWidth) + 0.5);

    if (w <= 1.0) {
      w = 1.0;
      cairo_set_line_join(this.cr, cairo_line_join_t.CAIRO_LINE_JOIN_MITER);
      cairo_set_line_cap(this.cr, cairo_line_cap_t.CAIRO_LINE_CAP_BUTT);
      cairo_set_line_width(this.cr, 1.0);
      this.m_lineWidthIsOdd = true;
    } else {
      cairo_set_line_join(this.cr, cairo_line_join_t.CAIRO_LINE_JOIN_ROUND);
      cairo_set_line_cap(this.cr, cairo_line_cap_t.CAIRO_LINE_CAP_ROUND);
      cairo_set_line_width(this.cr, w);
      this.m_lineWidthIsOdd = Math.trunc(w) % 2 === 1;
    }

    this.m_lineWidthInPixels = w;
  }

  override DrawSegmentChain(aPointList: readonly Vec2[] | SHAPE_LINE_CHAIN, aWidth: number): void {
    if (Array.isArray(aPointList)) {
      const list = aPointList as readonly Vec2[];

      for (let i = 0; i + 1 < list.length; ++i) this.DrawSegment(list[i]!, list[i + 1]!, aWidth);

      return;
    }

    const aLineChain = aPointList as SHAPE_LINE_CHAIN;
    let numPoints = aLineChain.PointCount();

    if (aLineChain.IsClosed()) numPoints += 1;

    for (let i = 0; i + 1 < numPoints; ++i)
      this.DrawSegment(aLineChain.CPoint(i), aLineChain.CPoint(i + 1), aWidth);
  }

  override DrawSegment(aStartPoint: Vec2, aEndPoint: Vec2, aWidth: number): void {
    if (this.m_isFillEnabled) {
      this.syncLineWidth(true, aWidth);

      const p0 = this.roundp(this.xform(aStartPoint));
      const p1 = this.roundp(this.xform(aEndPoint));

      cairo_move_to(this.cr, p0.x, p0.y);
      cairo_line_to(this.cr, p1.x, p1.y);
      cairo_set_source_rgba(
        this.cr,
        this.m_fillColor.r,
        this.m_fillColor.g,
        this.m_fillColor.b,
        this.m_fillColor.a,
      );
      cairo_stroke(this.cr);
    } else {
      aWidth /= 2.0;
      this.SetLineWidth(1.0);
      this.syncLineWidth();

      // Outline mode for tracks
      let startEndVector = { x: aEndPoint.x - aStartPoint.x, y: aEndPoint.y - aStartPoint.y };
      let lineAngle = atan2(startEndVector.y, startEndVector.x);

      const sa = sin(lineAngle + Math.PI / 2.0);
      const ca = cos(lineAngle + Math.PI / 2.0);

      const pa0 = this.xform({ x: aStartPoint.x + aWidth * ca, y: aStartPoint.y + aWidth * sa });
      const pa1 = this.xform({ x: aStartPoint.x - aWidth * ca, y: aStartPoint.y - aWidth * sa });
      const pb0 = this.xform({ x: aEndPoint.x + aWidth * ca, y: aEndPoint.y + aWidth * sa });
      const pb1 = this.xform({ x: aEndPoint.x - aWidth * ca, y: aEndPoint.y - aWidth * sa });

      cairo_set_source_rgba(
        this.cr,
        this.m_strokeColor.r,
        this.m_strokeColor.g,
        this.m_strokeColor.b,
        this.m_strokeColor.a,
      );

      cairo_move_to(this.cr, pa0.x, pa0.y);
      cairo_line_to(this.cr, pb0.x, pb0.y);

      cairo_move_to(this.cr, pa1.x, pa1.y);
      cairo_line_to(this.cr, pb1.x, pb1.y);
      this.flushPath();

      // Calculate the segment angle and arc center in normal/mirrored transform for rounded ends.
      const center_a = this.xform(aStartPoint);
      const center_b = this.xform(aEndPoint);
      startEndVector = { x: center_b.x - center_a.x, y: center_b.y - center_a.y };
      lineAngle = atan2(startEndVector.y, startEndVector.x);
      const radius = EuclideanNorm({ x: pa0.x - center_a.x, y: pa0.y - center_a.y });

      // Draw the rounded end point of the segment
      let arcStartAngle = lineAngle - Math.PI / 2.0;
      cairo_arc(this.cr, center_b.x, center_b.y, radius, arcStartAngle, arcStartAngle + Math.PI);

      // Draw the rounded start point of the segment
      arcStartAngle = lineAngle + Math.PI / 2.0;
      cairo_arc(this.cr, center_a.x, center_a.y, radius, arcStartAngle, arcStartAngle + Math.PI);

      this.flushPath();
    }

    this.m_isElementAdded = true;
  }

  override DrawHoleWall(aCenterPoint: Vec2, aHoleRadius: number, aWallWidth: number): void {
    this.DrawCircle(aCenterPoint, aHoleRadius + aWallWidth);
  }

  override DrawCircle(aCenterPoint: Vec2, aRadius: number): void {
    this.syncLineWidth();

    const c = this.roundp(this.xform(aCenterPoint));
    const r = roundpScalar(this.xform(aRadius));

    cairo_set_line_width(this.cr, Math.min(2.0 * r, this.m_lineWidthInPixels));
    cairo_new_sub_path(this.cr);
    cairo_arc(this.cr, c.x, c.y, r, 0.0, 2 * Math.PI);
    cairo_close_path(this.cr);
    this.flushPath();
    this.m_isElementAdded = true;
  }

  override DrawArc(
    aCenterPoint: Vec2,
    aRadius: number,
    aStartAngle: EDA_ANGLE,
    aAngle: EDA_ANGLE,
  ): void {
    this.syncLineWidth();

    let startAngle = aStartAngle.AsRadians();
    let endAngle = startAngle + aAngle.AsRadians();

    // calculate start and end arc angles according to the rotation transform matrix
    // and normalize:
    [startAngle, endAngle] = this.arc_angles_xform_and_normalize(startAngle, endAngle);

    let r = this.xform(aRadius);

    // Adjust center and radius slightly to better match the rounding of endpoints.
    const mid = this.roundp(this.xform(aCenterPoint));

    let startPointS: Vec2 = { x: r, y: 0.0 };
    let endPointS: Vec2 = { x: r, y: 0.0 };
    startPointS = RotatePointD(
      startPointS,
      new EDA_ANGLE(startAngle, EDA_ANGLE_T.RADIANS_T).negate(),
    );
    endPointS = RotatePointD(endPointS, new EDA_ANGLE(endAngle, EDA_ANGLE_T.RADIANS_T).negate());

    const center = this.xform(aCenterPoint);
    const refStart = this.roundp({ x: center.x + startPointS.x, y: center.y + startPointS.y });
    const refEnd = this.roundp({ x: center.x + endPointS.x, y: center.y + endPointS.y });

    r =
      (EuclideanNorm({ x: refStart.x - mid.x, y: refStart.y - mid.y }) +
        EuclideanNorm({ x: refEnd.x - mid.x, y: refEnd.y - mid.y })) /
      2.0;

    cairo_set_line_width(this.cr, this.m_lineWidthInPixels);
    cairo_new_sub_path(this.cr);

    if (this.m_isFillEnabled) cairo_move_to(this.cr, mid.x, mid.y);

    cairo_arc(this.cr, mid.x, mid.y, r, startAngle, endAngle);

    if (this.m_isFillEnabled) cairo_close_path(this.cr);

    this.flushPath();

    this.m_isElementAdded = true;
  }

  /// Note: aMaxError is not used in Cairo, because Cairo can draw true arcs
  override DrawArcSegment(
    aCenterPoint: Vec2,
    aRadius: number,
    aStartAngle: EDA_ANGLE,
    aAngle: EDA_ANGLE,
    aWidth: number,
    aMaxError: number,
  ): void {
    // Note: aMaxError is not used because Cairo can draw true arcs
    if (this.m_isFillEnabled) {
      this.m_lineWidth = Math.fround(aWidth); // a `float` member
      this.m_isStrokeEnabled = true;
      this.m_isFillEnabled = false;
      this.DrawArc(aCenterPoint, aRadius, aStartAngle, aAngle);
      this.m_isFillEnabled = true;
      this.m_isStrokeEnabled = false;
      return;
    }

    this.syncLineWidth();

    // calculate start and end arc angles according to the rotation transform matrix
    // and normalize:
    let startAngleS = aStartAngle.AsRadians();
    let endAngleS = startAngleS + aAngle.AsRadians();
    [startAngleS, endAngleS] = this.arc_angles_xform_and_normalize(startAngleS, endAngleS);

    const r = this.xform(aRadius);

    const mid = this.xform(aCenterPoint);
    const width = this.xform(aWidth / 2.0);
    let startPointS: Vec2 = { x: r, y: 0.0 };
    let endPointS: Vec2 = { x: r, y: 0.0 };
    startPointS = RotatePointD(
      startPointS,
      new EDA_ANGLE(startAngleS, EDA_ANGLE_T.RADIANS_T).negate(),
    );
    endPointS = RotatePointD(endPointS, new EDA_ANGLE(endAngleS, EDA_ANGLE_T.RADIANS_T).negate());

    cairo_save(this.cr);

    cairo_set_source_rgba(
      this.cr,
      this.m_strokeColor.r,
      this.m_strokeColor.g,
      this.m_strokeColor.b,
      this.m_strokeColor.a,
    );

    cairo_translate(this.cr, mid.x, mid.y);

    cairo_new_sub_path(this.cr);
    cairo_arc(this.cr, 0, 0, r - width, startAngleS, endAngleS);

    cairo_new_sub_path(this.cr);
    cairo_arc(this.cr, 0, 0, r + width, startAngleS, endAngleS);

    cairo_new_sub_path(this.cr);
    cairo_arc_negative(
      this.cr,
      startPointS.x,
      startPointS.y,
      width,
      startAngleS,
      startAngleS + Math.PI,
    );

    cairo_new_sub_path(this.cr);
    cairo_arc(this.cr, endPointS.x, endPointS.y, width, endAngleS, endAngleS + Math.PI);

    cairo_restore(this.cr);
    this.flushPath();

    this.m_isElementAdded = true;
  }

  override DrawRectangle(aStartPoint: Vec2, aEndPoint: Vec2): void {
    // Calculate the diagonal points
    this.syncLineWidth();

    const p0 = this.roundp(this.xform(aStartPoint));
    const p1 = this.roundp(this.xform({ x: aEndPoint.x, y: aStartPoint.y }));
    const p2 = this.roundp(this.xform(aEndPoint));
    const p3 = this.roundp(this.xform({ x: aStartPoint.x, y: aEndPoint.y }));

    // The path is composed from 4 segments
    cairo_move_to(this.cr, p0.x, p0.y);
    cairo_line_to(this.cr, p1.x, p1.y);
    cairo_line_to(this.cr, p2.x, p2.y);
    cairo_line_to(this.cr, p3.x, p3.y);
    cairo_close_path(this.cr);
    this.flushPath();

    this.m_isElementAdded = true;
  }

  /// @copydoc GAL::DrawPolyline()
  override DrawPolyline(aPointList: readonly Vec2[] | SHAPE_LINE_CHAIN): void {
    this.drawPoly(aPointList);
  }

  /// @copydoc GAL::DrawPolylines()
  override DrawPolylines(aPointLists: readonly (readonly Vec2[])[]): void {
    for (const points of aPointLists) this.drawPoly(points);
  }

  /// @copydoc GAL::DrawPolygon()
  override DrawPolygon(aPointList: readonly Vec2[] | SHAPE_LINE_CHAIN): void;
  override DrawPolygon(aPolySet: SHAPE_POLY_SET, aStrokeTriangulation?: boolean): void;
  override DrawPolygon(
    a: readonly Vec2[] | SHAPE_LINE_CHAIN | SHAPE_POLY_SET,
    aStrokeTriangulation = false,
  ): void {
    if (a instanceof SHAPE_POLY_SET) {
      for (let i = 0; i < a.OutlineCount(); ++i) this.drawPoly(a.COutline(i));

      return;
    }

    this.drawPoly(a);
  }

  /// @copydoc GAL::DrawGlyph()
  override DrawGlyph(aGlyph: GLYPH_LIKE, aNth = 0, aTotal = 1): void {
    if (aGlyph.IsStroke()) {
      const glyph = aGlyph as STROKE_GLYPH;

      for (const pointList of glyph.strokes) this.drawPoly(pointList);
    } else if (aGlyph.IsOutline()) {
      const glyph = aGlyph as OUTLINE_GLYPH;

      if (aNth === 0) {
        cairo_close_path(this.cr);
        this.flushPath();

        cairo_new_path(this.cr);
        this.SetIsFill(true);
        this.SetIsStroke(false);
      }

      // eventually glyphs should not be drawn as polygons at all,
      // but as bitmaps with antialiasing, this is just a stopgap measure
      // of getting some form of outline font display

      glyph.Triangulate((aVertex1: Vec2, aVertex2: Vec2, aVertex3: Vec2) => {
        this.syncLineWidth();

        const p0 = this.roundp(this.xform(aVertex1));
        const p1 = this.roundp(this.xform(aVertex2));
        const p2 = this.roundp(this.xform(aVertex3));

        cairo_move_to(this.cr, p0.x, p0.y);
        cairo_line_to(this.cr, p1.x, p1.y);
        cairo_line_to(this.cr, p2.x, p2.y);
        cairo_close_path(this.cr);
        cairo_set_fill_rule(this.cr, cairo_fill_rule_t.CAIRO_FILL_RULE_EVEN_ODD);
        this.flushPath();
        cairo_fill(this.cr);
      });

      if (aNth === aTotal - 1) {
        this.flushPath();
        this.SetIsFill(false);
        this.SetIsStroke(true);
        this.m_isElementAdded = true;
      }
    }
  }

  /// @copydoc GAL::DrawGlyphs(): no hover colour here, unlike the base class.
  override DrawGlyphs(aGlyphs: readonly GLYPH_LIKE[]): void {
    for (let i = 0; i < aGlyphs.length; i++) this.DrawGlyph(aGlyphs[i]!, i, aGlyphs.length);
  }

  /// @copydoc GAL::DrawCurve()
  override DrawCurve(
    aStartPoint: Vec2,
    aControlPointA: Vec2,
    aControlPointB: Vec2,
    aEndPoint: Vec2,
    aFilterValue = 0.0,
  ): void {
    // Note: aFilterValue is not used because the cubic Bezier curve is
    // supported by Cairo.
    this.syncLineWidth();

    const sp = this.roundp(this.xform(aStartPoint));
    const cpa = this.roundp(this.xform(aControlPointA));
    const cpb = this.roundp(this.xform(aControlPointB));
    const ep = this.roundp(this.xform(aEndPoint));

    cairo_move_to(this.cr, sp.x, sp.y);
    cairo_curve_to(this.cr, cpa.x, cpa.y, cpb.x, cpb.y, ep.x, ep.y);
    cairo_line_to(this.cr, ep.x, ep.y);

    this.flushPath();
    this.m_isElementAdded = true;
  }

  /**
   * @copydoc GAL::DrawBitmap()
   *
   * The pixels come from the BITMAP_BASE's `wxImage` (`WX_IMAGE`). Two gaps
   * against the C++: a JPEG's pixels are not decoded by `WX_IMAGE`, so a JPEG
   * image draws nothing here; and `WX_IMAGE` has no mask colour, so the
   * `HasMask()` branch cannot arise. The canvas takes straight alpha, so the
   * premultiply step (`r * a / 0xFF`) is the browser's.
   */
  override DrawBitmap(aBitmap: BITMAP_BASE, alphaBlend = 1.0): void {
    cairo_save(this.cr);

    alphaBlend = Math.min(Math.max(alphaBlend, 0.0), 1.0);

    // We have to calculate the pixel size in users units to draw the image.
    // m_worldUnitLength is a factor used for converting IU to inches
    const scale = 1.0 / (aBitmap.GetPPI() * this.m_worldUnitLength);

    // The position of the bitmap is the bitmap center.
    // move the draw origin to the top left bitmap corner:
    const w = aBitmap.GetSizePixels().x;
    const h = aBitmap.GetSizePixels().y;

    cairo_set_matrix(this.cr, this.m_currentWorld2Screen);
    cairo_scale(this.cr, scale, scale);
    cairo_translate(this.cr, -w / 2.0, -h / 2.0);

    cairo_new_path(this.cr);
    const image = cairo_image_surface_create(cairo_format_t.CAIRO_FORMAT_ARGB32, w, h);
    cairo_surface_flush(image);

    // The pixel buffer of the initial bitmap:
    const bm_pix_buffer = aBitmap.GetImageData();
    const rgb = bm_pix_buffer?.GetData() ?? null;

    if (rgb && w > 0 && h > 0) {
      const alpha = bm_pix_buffer!.GetAlpha();
      const pix = image.backing.ctx.createImageData(w, h);
      const pix_buffer = pix.data;

      // Copy the source bitmap to the cairo bitmap buffer.
      for (let row = 0; row < h; row++) {
        for (let col = 0; col < w; col++) {
          const i = row * w + col;
          const r = rgb[i * 3]!;
          const g = rgb[i * 3 + 1]!;
          const b = rgb[i * 3 + 2]!;
          let a = wxALPHA_OPAQUE;

          if (bm_pix_buffer!.HasAlpha()) a = alpha![i]!;

          pix_buffer[i * 4] = r;
          pix_buffer[i * 4 + 1] = g;
          pix_buffer[i * 4 + 2] = b;
          pix_buffer[i * 4 + 3] = a;
        }
      }

      image.backing.ctx.putImageData(pix, 0, 0);
    }

    cairo_surface_mark_dirty(image);
    cairo_set_source_surface(this.cr, image, 0, 0);
    cairo_paint_with_alpha(this.cr, alphaBlend);

    // store the image handle so it can be destroyed later
    this.m_imageSurfaces.push(image);

    this.m_isElementAdded = true;

    cairo_restore(this.cr);
  }

  // --------------
  // Screen methods
  // --------------

  /// Resizes the canvas.
  override ResizeScreen(aWidth: number, aHeight: number): void {
    this.m_screenSize = { x: aWidth, y: aHeight };
  }

  /// @copydoc GAL::Flush()
  override Flush(): void {
    this.storePath();
  }

  /// @copydoc GAL::ClearScreen()
  override ClearScreen(): void {
    const oldOp = cairo_get_operator(this.cr);
    cairo_set_source_rgba(
      this.cr,
      this.m_clearColor.r,
      this.m_clearColor.g,
      this.m_clearColor.b,
      this.m_clearColor.a,
    );
    cairo_set_operator(this.cr, cairo_operator_t.CAIRO_OPERATOR_SOURCE);
    cairo_rectangle(this.cr, 0.0, 0.0, this.m_screenSize.x, this.m_screenSize.y);
    cairo_fill(this.cr);
    cairo_set_operator(this.cr, oldOp);
  }

  // -----------------
  // Attribute setting
  // -----------------

  override SetIsFill(aIsFillEnabled: boolean): void {
    this.storePath();
    this.m_isFillEnabled = aIsFillEnabled;

    if (this.m_isGrouping) {
      const groupElement = newGroupElement(GRAPHICS_COMMAND.CMD_SET_FILL);
      groupElement.m_Argument.BoolArg = aIsFillEnabled;
      this.m_currentGroup!.push(groupElement);
    }
  }

  override SetIsStroke(aIsStrokeEnabled: boolean): void {
    this.storePath();
    this.m_isStrokeEnabled = aIsStrokeEnabled;

    if (this.m_isGrouping) {
      const groupElement = newGroupElement(GRAPHICS_COMMAND.CMD_SET_STROKE);
      groupElement.m_Argument.BoolArg = aIsStrokeEnabled;
      this.m_currentGroup!.push(groupElement);
    }
  }

  override SetStrokeColor(aColor: Color4d): void {
    this.storePath();
    this.m_strokeColor = aColor;

    if (this.m_isGrouping) {
      const groupElement = newGroupElement(GRAPHICS_COMMAND.CMD_SET_STROKECOLOR);
      groupElement.m_Argument.DblArg[0] = this.m_strokeColor.r;
      groupElement.m_Argument.DblArg[1] = this.m_strokeColor.g;
      groupElement.m_Argument.DblArg[2] = this.m_strokeColor.b;
      groupElement.m_Argument.DblArg[3] = this.m_strokeColor.a;
      this.m_currentGroup!.push(groupElement);
    }
  }

  override SetFillColor(aColor: Color4d): void {
    this.storePath();
    this.m_fillColor = aColor;

    if (this.m_isGrouping) {
      const groupElement = newGroupElement(GRAPHICS_COMMAND.CMD_SET_FILLCOLOR);
      groupElement.m_Argument.DblArg[0] = this.m_fillColor.r;
      groupElement.m_Argument.DblArg[1] = this.m_fillColor.g;
      groupElement.m_Argument.DblArg[2] = this.m_fillColor.b;
      groupElement.m_Argument.DblArg[3] = this.m_fillColor.a;
      this.m_currentGroup!.push(groupElement);
    }
  }

  override SetLineWidth(aLineWidth: number): void {
    const lineWidth = Math.fround(aLineWidth); // a `float` parameter

    this.storePath();
    super.SetLineWidth(lineWidth);

    if (this.m_isGrouping) {
      const groupElement = newGroupElement(GRAPHICS_COMMAND.CMD_SET_LINE_WIDTH);
      groupElement.m_Argument.DblArg[0] = lineWidth;
      this.m_currentGroup!.push(groupElement);
    } else {
      this.m_lineWidth = lineWidth;
    }
  }

  override SetLayerDepth(aLayerDepth: number): void {
    super.SetLayerDepth(aLayerDepth);
    this.storePath();
  }

  // --------------
  // Transformation
  // --------------

  override Transform(aTransformation: MATRIX3x3D): void {
    const cairoTransformation = cairo_matrix_new();
    const newXform = cairo_matrix_new();

    cairo_matrix_init(
      cairoTransformation,
      aTransformation.m_data[0][0],
      aTransformation.m_data[1][0],
      aTransformation.m_data[0][1],
      aTransformation.m_data[1][1],
      aTransformation.m_data[0][2],
      aTransformation.m_data[1][2],
    );

    cairo_matrix_multiply(newXform, this.m_currentXform, cairoTransformation);
    this.m_currentXform = newXform;
    this.updateWorldScreenMatrix();
  }

  override Rotate(aAngle: number): void {
    this.storePath();

    if (this.m_isGrouping) {
      const groupElement = newGroupElement(GRAPHICS_COMMAND.CMD_ROTATE);
      groupElement.m_Argument.DblArg[0] = aAngle;
      this.m_currentGroup!.push(groupElement);
    } else {
      cairo_matrix_rotate(this.m_currentXform, aAngle);
      this.updateWorldScreenMatrix();
    }
  }

  override Translate(aTranslation: Vec2): void {
    this.storePath();

    if (this.m_isGrouping) {
      const groupElement = newGroupElement(GRAPHICS_COMMAND.CMD_TRANSLATE);
      groupElement.m_Argument.DblArg[0] = aTranslation.x;
      groupElement.m_Argument.DblArg[1] = aTranslation.y;
      this.m_currentGroup!.push(groupElement);
    } else {
      cairo_matrix_translate(this.m_currentXform, aTranslation.x, aTranslation.y);
      this.updateWorldScreenMatrix();
    }
  }

  override Scale(aScale: Vec2): void {
    this.storePath();

    if (this.m_isGrouping) {
      const groupElement = newGroupElement(GRAPHICS_COMMAND.CMD_SCALE);
      groupElement.m_Argument.DblArg[0] = aScale.x;
      groupElement.m_Argument.DblArg[1] = aScale.y;
      this.m_currentGroup!.push(groupElement);
    } else {
      cairo_matrix_scale(this.m_currentXform, aScale.x, aScale.y);
      this.updateWorldScreenMatrix();
    }
  }

  override Save(): void {
    this.storePath();

    if (this.m_isGrouping) {
      const groupElement = newGroupElement(GRAPHICS_COMMAND.CMD_SAVE);
      this.m_currentGroup!.push(groupElement);
    } else {
      this.m_xformStack.push({ ...this.m_currentXform });
      this.updateWorldScreenMatrix();
    }
  }

  override Restore(): void {
    this.storePath();

    if (this.m_isGrouping) {
      const groupElement = newGroupElement(GRAPHICS_COMMAND.CMD_RESTORE);
      this.m_currentGroup!.push(groupElement);
    } else {
      if (this.m_xformStack.length > 0) {
        this.m_currentXform = this.m_xformStack.pop()!;
        this.updateWorldScreenMatrix();
      }
    }
  }

  // --------------------------------------------
  // Group methods
  // ---------------------------------------------

  /** `m_groups[aGroupNumber]`: `std::map::operator[]` makes an empty group when there is none. */
  private groupAt(aGroupNumber: number): GROUP {
    let group = this.m_groups.get(aGroupNumber);

    if (!group) {
      group = [];
      this.m_groups.set(aGroupNumber, group);
    }

    return group;
  }

  override BeginGroup(): number {
    // If the grouping is started: the actual path is stored in the group, when
    // a attribute was changed or when grouping stops with the end group method.
    this.storePath();

    const group: GROUP = [];
    const groupNumber = this.getNewGroupNumber();
    this.m_groups.set(groupNumber, group);
    this.m_currentGroup = this.groupAt(groupNumber);
    this.m_isGrouping = true;

    return groupNumber;
  }

  override EndGroup(): void {
    this.storePath();
    this.m_isGrouping = false;
  }

  override DrawGroup(aGroupNumber: number): void {
    // This method implements a small Virtual Machine - all stored commands
    // are executed; nested calling is also possible

    this.storePath();

    for (const it of this.groupAt(aGroupNumber)) {
      switch (it.m_Command) {
        case GRAPHICS_COMMAND.CMD_SET_FILL:
          this.m_isFillEnabled = it.m_Argument.BoolArg;
          break;

        case GRAPHICS_COMMAND.CMD_SET_STROKE:
          this.m_isStrokeEnabled = it.m_Argument.BoolArg;
          break;

        case GRAPHICS_COMMAND.CMD_SET_FILLCOLOR:
          this.m_fillColor = COLOR4D(
            it.m_Argument.DblArg[0]!,
            it.m_Argument.DblArg[1]!,
            it.m_Argument.DblArg[2]!,
            it.m_Argument.DblArg[3]!,
          );
          break;

        case GRAPHICS_COMMAND.CMD_SET_STROKECOLOR:
          this.m_strokeColor = COLOR4D(
            it.m_Argument.DblArg[0]!,
            it.m_Argument.DblArg[1]!,
            it.m_Argument.DblArg[2]!,
            it.m_Argument.DblArg[3]!,
          );
          break;

        case GRAPHICS_COMMAND.CMD_SET_LINE_WIDTH: {
          // Make lines appear at least 1 pixel wide, no matter of zoom
          const d = cairo_device_to_user_distance(this.cr, 1.0, 1.0);
          const minWidth = Math.min(Math.abs(d.x), Math.abs(d.y));
          cairo_set_line_width(this.cr, Math.max(it.m_Argument.DblArg[0]!, minWidth));
          break;
        }

        case GRAPHICS_COMMAND.CMD_STROKE_PATH:
          cairo_set_source_rgba(
            this.cr,
            this.m_strokeColor.r,
            this.m_strokeColor.g,
            this.m_strokeColor.b,
            this.m_strokeColor.a,
          );
          cairo_append_path(this.cr, it.m_CairoPath);
          cairo_stroke(this.cr);
          break;

        case GRAPHICS_COMMAND.CMD_FILL_PATH:
          // The alpha is the STROKE colour's, in the C++ too.
          cairo_set_source_rgba(
            this.cr,
            this.m_fillColor.r,
            this.m_fillColor.g,
            this.m_fillColor.b,
            this.m_strokeColor.a,
          );
          cairo_append_path(this.cr, it.m_CairoPath);
          cairo_fill(this.cr);
          break;

        case GRAPHICS_COMMAND.CMD_ROTATE:
          cairo_rotate(this.cr, it.m_Argument.DblArg[0]!);
          break;

        case GRAPHICS_COMMAND.CMD_TRANSLATE:
          cairo_translate(this.cr, it.m_Argument.DblArg[0]!, it.m_Argument.DblArg[1]!);
          break;

        case GRAPHICS_COMMAND.CMD_SCALE:
          cairo_scale(this.cr, it.m_Argument.DblArg[0]!, it.m_Argument.DblArg[1]!);
          break;

        case GRAPHICS_COMMAND.CMD_SAVE:
          cairo_save(this.cr);
          break;

        case GRAPHICS_COMMAND.CMD_RESTORE:
          cairo_restore(this.cr);
          break;

        case GRAPHICS_COMMAND.CMD_CALL_GROUP:
          this.DrawGroup(it.m_Argument.IntArg);
          break;
      }
    }
  }

  override ChangeGroupColor(aGroupNumber: number, aNewColor: Color4d): void {
    this.storePath();

    for (const it of this.groupAt(aGroupNumber)) {
      if (
        it.m_Command === GRAPHICS_COMMAND.CMD_SET_FILLCOLOR ||
        it.m_Command === GRAPHICS_COMMAND.CMD_SET_STROKECOLOR
      ) {
        it.m_Argument.DblArg[0] = aNewColor.r;
        it.m_Argument.DblArg[1] = aNewColor.g;
        it.m_Argument.DblArg[2] = aNewColor.b;
        it.m_Argument.DblArg[3] = aNewColor.a;
      }
    }
  }

  override ChangeGroupDepth(aGroupNumber: number, aDepth: number): void {
    // Cairo does not have any possibilities to change the depth coordinate of stored items,
    // it depends only on the order of drawing
  }

  override DeleteGroup(aGroupNumber: number): void {
    this.storePath();

    // Delete the Cairo paths
    for (const it of this.groupAt(aGroupNumber)) {
      if (
        it.m_Command === GRAPHICS_COMMAND.CMD_FILL_PATH ||
        it.m_Command === GRAPHICS_COMMAND.CMD_STROKE_PATH
      )
        cairo_path_destroy(it.m_CairoPath);
    }

    // Delete the group
    this.m_groups.delete(aGroupNumber);
  }

  override ClearCache(): void {
    for (const key of [...this.m_groups.keys()]) this.DeleteGroup(key);
  }

  // --------------------------------------------------------
  // Handling the world <-> screen transformation
  // --------------------------------------------------------

  override SetNegativeDrawMode(aSetting: boolean): void {
    cairo_set_operator(
      this.cr,
      aSetting ? cairo_operator_t.CAIRO_OPERATOR_CLEAR : cairo_operator_t.CAIRO_OPERATOR_OVER,
    );
  }

  // -------
  // Cursor
  // -------

  override DrawCursor(aCursorPosition: Vec2): void {
    this.m_cursorPosition = aCursorPosition;
  }

  override EnableDepthTest(aEnabled = false): void {}

  protected resetContext(): void {
    for (const imageSurface of this.m_imageSurfaces) cairo_surface_destroy(imageSurface);

    this.m_imageSurfaces = [];

    this.ClearScreen();

    // Compute the world <-> screen transformations
    this.ComputeWorldScreenMatrix();

    const m = this.m_worldScreenMatrix.m_data;
    cairo_matrix_init(
      this.m_cairoWorldScreenMatrix,
      m[0][0],
      m[1][0],
      m[0][1],
      m[1][1],
      m[0][2],
      m[1][2],
    );

    // we work in screen-space coordinates and do the transforms outside.
    cairo_identity_matrix(this.m_context!);

    cairo_matrix_init_identity(this.m_currentXform);

    // Start drawing with a new path
    cairo_new_path(this.m_context!);
    this.m_isElementAdded = true;

    this.updateWorldScreenMatrix();

    this.m_lineWidth = 0;
  }

  /**
   * Draw a grid line (usually a simplified line function).
   *
   * @param aStartPoint is the start point of the line.
   * @param aEndPoint is the end point of the line.
   */
  protected drawGridLine(aStartPoint: Vec2, aEndPoint: Vec2): void {
    this.syncLineWidth();
    const p0 = this.roundp(this.xform(aStartPoint));
    const p1 = this.roundp(this.xform(aEndPoint));

    cairo_set_source_rgba(
      this.cr,
      this.m_gridColor.r,
      this.m_gridColor.g,
      this.m_gridColor.b,
      this.m_gridColor.a,
    );
    cairo_move_to(this.cr, p0.x, p0.y);
    cairo_line_to(this.cr, p1.x, p1.y);
    cairo_stroke(this.cr);
  }

  protected drawGridCross(aPoint: Vec2): void {
    this.syncLineWidth();
    const offset = { x: 0, y: 0 };
    const size = 2.0 * this.m_lineWidthInPixels + 0.5;

    const c = this.roundp(this.xform(aPoint));
    const p0 = { x: c.x - size + offset.x, y: c.y + offset.y };
    const p1 = { x: c.x + size + offset.x, y: c.y + offset.y };
    const p2 = { x: c.x + offset.x, y: c.y - size + offset.y };
    const p3 = { x: c.x + offset.x, y: c.y + size + offset.y };

    cairo_set_source_rgba(
      this.cr,
      this.m_gridColor.r,
      this.m_gridColor.g,
      this.m_gridColor.b,
      this.m_gridColor.a,
    );
    cairo_move_to(this.cr, p0.x, p0.y);
    cairo_line_to(this.cr, p1.x, p1.y);
    cairo_move_to(this.cr, p2.x, p2.y);
    cairo_line_to(this.cr, p3.x, p3.y);
    cairo_stroke(this.cr);
  }

  protected drawGridPoint(aPoint: Vec2, aWidth: number, aHeight: number): void {
    const p = this.roundp(this.xform(aPoint));

    const sw = Math.max(1.0, aWidth);
    const sh = Math.max(1.0, aHeight);

    cairo_set_source_rgba(
      this.cr,
      this.m_gridColor.r,
      this.m_gridColor.g,
      this.m_gridColor.b,
      this.m_gridColor.a,
    );
    cairo_rectangle(
      this.cr,
      p.x - Math.floor(sw / 2) - 0.5,
      p.y - Math.floor(sh / 2) - 0.5,
      sw,
      sh,
    );

    cairo_fill(this.cr);
  }

  protected drawAxes(aStartPoint: Vec2, aEndPoint: Vec2): void {
    this.syncLineWidth();

    const p0 = this.roundp(this.xform(aStartPoint));
    const p1 = this.roundp(this.xform(aEndPoint));
    const org = this.roundp(this.xform({ x: 0.0, y: 0.0 })); // Axis origin = 0,0 coord

    cairo_set_source_rgba(
      this.cr,
      this.m_axesColor.r,
      this.m_axesColor.g,
      this.m_axesColor.b,
      this.m_axesColor.a,
    );
    cairo_move_to(this.cr, p0.x, org.y);
    cairo_line_to(this.cr, p1.x, org.y);
    cairo_move_to(this.cr, org.x, p0.y);
    cairo_line_to(this.cr, org.x, p1.y);
    cairo_stroke(this.cr);
  }

  protected flushPath(): void {
    if (this.m_isFillEnabled) {
      cairo_set_source_rgba(
        this.cr,
        this.m_fillColor.r,
        this.m_fillColor.g,
        this.m_fillColor.b,
        this.m_fillColor.a,
      );

      if (this.m_isStrokeEnabled) {
        cairo_set_line_width(this.cr, this.m_lineWidthInPixels);
        cairo_fill_preserve(this.cr);
      } else {
        cairo_fill(this.cr);
      }
    }

    if (this.m_isStrokeEnabled) {
      cairo_set_line_width(this.cr, this.m_lineWidthInPixels);
      cairo_set_source_rgba(
        this.cr,
        this.m_strokeColor.r,
        this.m_strokeColor.g,
        this.m_strokeColor.b,
        this.m_strokeColor.a,
      );
      cairo_stroke(this.cr);
    }
  }

  ///< Store the actual path
  protected storePath(): void {
    if (this.m_isElementAdded) {
      this.m_isElementAdded = false;

      if (!this.m_isGrouping) {
        if (this.m_isFillEnabled) {
          cairo_set_source_rgba(
            this.cr,
            this.m_fillColor.r,
            this.m_fillColor.g,
            this.m_fillColor.b,
            this.m_fillColor.a,
          );
          cairo_fill_preserve(this.cr);
        }

        if (this.m_isStrokeEnabled) {
          cairo_set_source_rgba(
            this.cr,
            this.m_strokeColor.r,
            this.m_strokeColor.g,
            this.m_strokeColor.b,
            this.m_strokeColor.a,
          );
          cairo_stroke_preserve(this.cr);
        }
      } else {
        // Copy the actual path, append it to the global path list
        // then check, if the path needs to be stroked/filled and
        // add this command to the group list;
        if (this.m_isStrokeEnabled) {
          const groupElement = newGroupElement(GRAPHICS_COMMAND.CMD_STROKE_PATH);
          groupElement.m_CairoPath = cairo_copy_path(this.cr);
          this.m_currentGroup!.push(groupElement);
        }

        if (this.m_isFillEnabled) {
          const groupElement = newGroupElement(GRAPHICS_COMMAND.CMD_FILL_PATH);
          groupElement.m_CairoPath = cairo_copy_path(this.cr);
          this.m_currentGroup!.push(groupElement);
        }
      }

      cairo_new_path(this.cr);
    }
  }

  /**
   * Blit cursor into the current screen.
   *
   * `clientDC` is the `wxMemoryDC` over the frame's bitmap; wx's `DrawLine`
   * with a one-pixel `wxPen` is drawn half a pixel in, where wxGTK3's Cairo
   * DC puts an odd-width line so it covers whole pixels.
   */
  protected blitCursor(clientDC: CANVAS_2D): void {
    if (!this.IsCursorEnabled()) return;

    const p = this.ToScreen(this.m_cursorPosition);
    const cColor = this.getCursorColor();

    // wxColour( unsigned char, ... ): the double converts by truncation
    const color = `rgb(${Math.trunc(cColor.r * cColor.a * 255)}, ${Math.trunc(
      cColor.g * cColor.a * 255,
    )}, ${Math.trunc(cColor.b * cColor.a * 255)})`;

    // wxDC::DrawLine( wxCoord, ... ): each coordinate converts by truncation
    const DrawLine = (x1: number, y1: number, x2: number, y2: number): void => {
      clientDC.setTransform(1, 0, 0, 1, 0, 0);
      clientDC.globalAlpha = 1;
      clientDC.globalCompositeOperation = 'source-over';
      clientDC.lineWidth = 1;
      clientDC.lineCap = 'butt';
      clientDC.strokeStyle = color;
      clientDC.beginPath();
      clientDC.moveTo(Math.trunc(x1) + 0.5, Math.trunc(y1) + 0.5);
      clientDC.lineTo(Math.trunc(x2) + 0.5, Math.trunc(y2) + 0.5);
      clientDC.stroke();
    };

    if (this.m_crossHairMode === CROSS_HAIR_MODE.FULLSCREEN_CROSS) {
      DrawLine(0, p.y, this.m_screenSize.x, p.y);
      DrawLine(p.x, 0, p.x, this.m_screenSize.y);
    } else if (this.m_crossHairMode === CROSS_HAIR_MODE.FULLSCREEN_DIAGONAL) {
      // Oversized but that's ok
      const diagonalSize = this.m_screenSize.x + this.m_screenSize.y;
      DrawLine(p.x - diagonalSize, p.y - diagonalSize, p.x + diagonalSize, p.y + diagonalSize);
      DrawLine(p.x - diagonalSize, p.y + diagonalSize, p.x + diagonalSize, p.y - diagonalSize);
    } else {
      const cursorSize = 80;
      DrawLine(p.x - cursorSize / 2, p.y, p.x + cursorSize / 2, p.y);
      DrawLine(p.x, p.y - cursorSize / 2, p.x, p.y + cursorSize / 2);
    }
  }

  /// Drawing polygons & polylines is the same in Cairo, so here is the common code
  protected drawPoly(aPointList: readonly Vec2[] | SHAPE_LINE_CHAIN): void {
    if (Array.isArray(aPointList)) {
      const list = aPointList as readonly Vec2[];

      if (list.length <= 1) return;

      // Iterate over the point list and draw the segments
      this.syncLineWidth();

      const p = this.roundp(this.xform(list[0]!.x, list[0]!.y));

      cairo_move_to(this.cr, p.x, p.y);

      for (let i = 1; i < list.length; ++i) {
        const p2 = this.roundp(this.xform(list[i]!.x, list[i]!.y));

        cairo_line_to(this.cr, p2.x, p2.y);
      }

      this.flushPath();
      this.m_isElementAdded = true;
      return;
    }

    const aLineChain = aPointList as SHAPE_LINE_CHAIN;

    if (aLineChain.PointCount() <= 1) return;

    this.syncLineWidth();

    let numPoints = aLineChain.PointCount();

    if (aLineChain.IsClosed()) numPoints += 1;

    const start = aLineChain.CPoint(0);
    const p = this.roundp(this.xform(start.x, start.y));
    cairo_move_to(this.cr, p.x, p.y);

    for (let i = 1; i < numPoints; ++i) {
      const pw = aLineChain.CPoint(i);
      const ps = this.roundp(this.xform(pw.x, pw.y));
      cairo_line_to(this.cr, ps.x, ps.y);
    }

    this.flushPath();
    this.m_isElementAdded = true;
  }

  /**
   * Return a valid key that can be used as a new group number.
   *
   * @return An unique group number that is not used by any other group.
   */
  protected getNewGroupNumber(): number {
    while (this.m_groups.has(this.m_groupCounter)) this.m_groupCounter++;

    return this.m_groupCounter++;
  }

  ///< @copydoc GAL::DrawGrid()
  override DrawGrid(): void {
    this.SetTarget(TARGET_NONCACHED);

    // Draw the grid
    // For the drawing the start points, end points and increments have
    // to be calculated in world coordinates
    const worldStartPoint = this.m_screenWorldMatrix.mulVec2({ x: 0.0, y: 0.0 });
    const worldEndPoint = this.m_screenWorldMatrix.mulVec2(this.m_screenSize);

    // Compute the line marker or point radius of the grid
    // Note: generic grids can't handle sub-pixel lines without
    // either losing fine/course distinction or having some dots
    // fail to render
    const marker = Math.fround(Math.max(1.0, this.m_gridLineWidth) / this.m_worldScale);
    const doubleMarker = Math.fround(2.0 * marker);

    // Draw axes if desired
    if (this.m_axesEnabled) {
      this.SetLineWidth(marker);
      this.drawAxes(worldStartPoint, worldEndPoint);
    }

    if (!this.m_gridVisibility || this.m_gridSize.x === 0 || this.m_gridSize.y === 0) return;

    let gridScreenSize: Vec2 = { x: this.m_gridSize.x, y: this.m_gridSize.y };

    let gridThreshold = KiROUND(this.computeMinGridSpacing() / this.m_worldScale);

    if (this.m_gridStyle === GRID_STYLE.SMALL_CROSS) gridThreshold *= 2.0;

    // If we cannot display the grid density, scale down by a tick size and
    // try again.  Eventually, we get some representation of the grid
    while (Math.min(gridScreenSize.x, gridScreenSize.y) <= gridThreshold) {
      gridScreenSize = {
        x: gridScreenSize.x * this.m_gridTick,
        y: gridScreenSize.y * this.m_gridTick,
      };
    }

    // Compute grid starting and ending indexes to draw grid points on the
    // visible screen area
    // Note: later any point coordinate will be offsetted by m_gridOrigin
    let gridStartX = KiROUND((worldStartPoint.x - this.m_gridOrigin.x) / gridScreenSize.x);
    let gridEndX = KiROUND((worldEndPoint.x - this.m_gridOrigin.x) / gridScreenSize.x);
    let gridStartY = KiROUND((worldStartPoint.y - this.m_gridOrigin.y) / gridScreenSize.y);
    let gridEndY = KiROUND((worldEndPoint.y - this.m_gridOrigin.y) / gridScreenSize.y);

    // Ensure start coordinate < end coordinate
    [gridStartX, gridEndX] = this.normalize(gridStartX, gridEndX);
    [gridStartY, gridEndY] = this.normalize(gridStartY, gridEndY);

    // Ensure the grid fills the screen
    --gridStartX;
    ++gridEndX;
    --gridStartY;
    ++gridEndY;

    // Draw the grid behind all other layers
    this.SetLayerDepth(this.m_depthRange.y * 0.75);

    if (this.m_gridStyle === GRID_STYLE.LINES) {
      // Now draw the grid, every coarse grid line gets the double width

      // Vertical lines
      for (let j = gridStartY; j <= gridEndY; j++) {
        const y = j * gridScreenSize.y + this.m_gridOrigin.y;

        if (this.m_axesEnabled && y === 0.0) continue;

        this.SetLineWidth(j % this.m_gridTick ? marker : doubleMarker);
        this.drawGridLine(
          { x: gridStartX * gridScreenSize.x + this.m_gridOrigin.x, y },
          { x: gridEndX * gridScreenSize.x + this.m_gridOrigin.x, y },
        );
      }

      // Horizontal lines
      for (let i = gridStartX; i <= gridEndX; i++) {
        const x = i * gridScreenSize.x + this.m_gridOrigin.x;

        if (this.m_axesEnabled && x === 0.0) continue;

        this.SetLineWidth(i % this.m_gridTick ? marker : doubleMarker);
        this.drawGridLine(
          { x, y: gridStartY * gridScreenSize.y + this.m_gridOrigin.y },
          { x, y: gridEndY * gridScreenSize.y + this.m_gridOrigin.y },
        );
      }
    } // Dots or Crosses grid
    else {
      this.m_lineWidthIsOdd = true;
      this.m_isStrokeEnabled = true;

      for (let j = gridStartY; j <= gridEndY; j++) {
        const tickY = j % this.m_gridTick === 0;

        for (let i = gridStartX; i <= gridEndX; i++) {
          const tickX = i % this.m_gridTick === 0;
          const pos: Vec2 = {
            x: i * gridScreenSize.x + this.m_gridOrigin.x,
            y: j * gridScreenSize.y + this.m_gridOrigin.y,
          };

          if (this.m_gridStyle === GRID_STYLE.SMALL_CROSS) {
            this.SetLineWidth(tickX && tickY ? doubleMarker : marker);
            this.drawGridCross(pos);
          } else if (this.m_gridStyle === GRID_STYLE.DOTS) {
            const doubleGridLineWidth = Math.fround(this.m_gridLineWidth * 2.0);
            this.drawGridPoint(
              pos,
              tickX ? doubleGridLineWidth : this.m_gridLineWidth,
              tickY ? doubleGridLineWidth : this.m_gridLineWidth,
            );
          }
        }
      }
    }
  }
}

/**
 * What the C++ gets from being a `wxWindow` child of the draw panel: the
 * panel's canvas and the window services around it. `EDA_DRAW_PANEL_GAL`
 * implements it.
 */
export interface CAIRO_GAL_WINDOW {
  /**
   * The `wxClientDC`: a 2D context on the visible canvas, or null when the
   * canvas already holds a WebGL context (a canvas has one context type for
   * life).
   */
  GetContext2D(): CANVAS_2D | null;
  /** `aParent->GetClientSize()`, in logical pixels. */
  GetClientSize(): VECTOR2I;
  /** The canvas's backing store, which the blit fills. */
  GetNativePixelSize(): VECTOR2I;
  /** `IsShownOnScreen() && !GetClientRect().IsEmpty()`. */
  IsShownOnScreen(): boolean;
  /** `wxWindow::Refresh()`. */
  Refresh(): void;
  /** `wxWindow::SetCursor( CURSOR_STORE::GetCursor( aCursor, aHiDPI ) )`. */
  SetCursor(aCursor: KICURSOR, aHiDPI: boolean): void;
  /** `wxPostEvent( m_paintListener, aEvent )`. */
  PostPaint(): void;
}

export class CAIRO_GAL extends CAIRO_GAL_BASE {
  // Compositor related variables
  protected m_compositor!: CAIRO_COMPOSITOR | null; ///< Object for layers compositing
  protected m_mainBuffer!: number; ///< Handle to the main buffer
  protected m_overlayBuffer!: number; ///< Handle to the overlay buffer
  protected m_tempBuffer!: number; ///< Handle to the temp buffer
  protected m_savedBuffer!: number; ///< Handle to buffer to restore after rendering to temp buffer
  protected m_currentTarget!: RENDER_TARGET; ///< Current rendering target
  protected m_validCompositor!: boolean; ///< Compositor initialization flag

  // Variables related to wxWidgets
  protected m_window!: CAIRO_GAL_WINDOW; ///< The window: the parent's canvas
  protected m_clientDC!: CANVAS_2D; ///< The visible canvas's 2D context
  protected m_bufferSize!: number; ///< Size of buffers cairoOutput, bitmapBuffers

  // Variables related to Cairo <-> wxWidgets
  protected m_bitmapBuffer!: cairo_surface_t | null; ///< Storage of the Cairo image
  protected m_stride!: number; ///< Stride value for Cairo
  protected m_wxBufferWidth!: number;
  protected m_isInitialized!: boolean; ///< Are Cairo image & surface ready to use
  protected m_backgroundColor!: Color4d; ///< Background color

  /**
   * @param aWindow is the canvas the parent draw panel owns, and its window
   *                services; the mouse and paint listeners are the panel's.
   */
  constructor(aDisplayOptions: GAL_DISPLAY_OPTIONS, aWindow: CAIRO_GAL_WINDOW) {
    // A canvas that already has a WebGL context will not give a 2D one. Thrown before
    // GAL subscribes to the options, so no half-built GAL stays subscribed.
    const clientDC = aWindow.GetContext2D();

    if (!clientDC)
      throw new Error('Could not create Cairo surface: the canvas holds another context');

    super(aDisplayOptions);

    this.m_window = aWindow;
    this.m_clientDC = clientDC;
    this.m_compositor = null;

    // Initialise compositing state
    this.m_mainBuffer = 0;
    this.m_overlayBuffer = 0;
    this.m_tempBuffer = 0;
    this.m_savedBuffer = 0;
    this.m_validCompositor = false;
    this.m_currentTarget = TARGET_NONCACHED;
    this.SetTarget(TARGET_NONCACHED);

    this.m_bitmapBuffer = null;

    // SetSize( aParent->GetClientSize() ): the panel sizes the element.
    this.m_screenSize = { ...aWindow.GetClientSize() };

    // Allocate memory for pixel storage
    this.allocateBitmaps();

    this.m_isInitialized = false;
  }

  /** `~CAIRO_GAL()`. */
  override destroy(): void {
    this.deleteBitmaps();
    super.destroy();
  }

  ///< @copydoc GAL::IsVisible()
  override IsVisible(): boolean {
    return this.m_window.IsShownOnScreen();
  }

  override BeginDrawing(): void {
    this.initSurface();

    super.BeginDrawing();

    if (!this.m_validCompositor) this.setCompositor();

    this.m_compositor!.SetMainContext(this.m_context!);
    this.m_compositor!.SetBuffer(this.m_mainBuffer);
  }

  override EndDrawing(): void {
    super.EndDrawing();

    // Merge buffers on the screen
    this.m_compositor!.DrawBuffer(this.m_mainBuffer);
    this.m_compositor!.DrawBuffer(this.m_overlayBuffer);

    // The C++ now copies the XRGB bytes into a wxImage, dropping alpha, and
    // blits that. Over opaque black, the premultiplied pixels ARE those bytes.
    const bitmap = this.m_bitmapBuffer!.backing;

    // Now it is the time to blit the mouse cursor
    this.blitCursor(bitmap.ctx);

    const clientDC = this.m_clientDC;
    const native = this.m_window.GetNativePixelSize();
    clientDC.setTransform(1, 0, 0, 1, 0, 0);
    clientDC.globalAlpha = 1;
    clientDC.globalCompositeOperation = 'source-over';
    clientDC.fillStyle = 'rgb(0, 0, 0)';
    clientDC.fillRect(0, 0, native.x, native.y);
    // clientDC.Blit( 0, 0, m_screenSize.x, m_screenSize.y, &mdc, 0, 0, wxCOPY ), onto
    // a backing store at the display's scale
    clientDC.drawImage(
      bitmap.image,
      0,
      0,
      this.m_screenSize.x,
      this.m_screenSize.y,
      0,
      0,
      native.x,
      native.y,
    );

    this.deinitSurface();
  }

  /**
   * Post an event to m_paint_listener.
   *
   * A post is used so that the actual drawing function can use a device context type that
   * is not specific to the wxEVT_PAINT event, just by changing the PostPaint code.
   */
  PostPaint(): void {
    // posts an event to m_paint_listener to ask for redraw the canvas.
    this.m_window.PostPaint();
  }

  override ResizeScreen(aWidth: number, aHeight: number): void {
    super.ResizeScreen(aWidth, aHeight);

    // Recreate the bitmaps
    this.deleteBitmaps();
    this.allocateBitmaps();

    if (this.m_validCompositor) this.m_compositor!.Resize(aWidth, aHeight);

    this.m_validCompositor = false;

    // SetSize( wxSize( aWidth, aHeight ) ): the panel sizes the element.
  }

  override Show(aShow: boolean): boolean {
    // wxWindow::Show / Raise: the canvas is the panel's.
    return true;
  }

  override BeginGroup(): number {
    this.initSurface();
    return super.BeginGroup();
  }

  override EndGroup(): void {
    super.EndGroup();
    this.deinitSurface();
  }

  override SetTarget(aTarget: RENDER_TARGET): void {
    // If the compositor is not set, that means that there is a recaching process going on
    // and we do not need the compositor now
    if (!this.m_validCompositor) return;

    // Cairo grouping prevents display of overlapping items on the same layer in the lighter color
    if (this.m_isInitialized) this.storePath();

    switch (aTarget) {
      default:
      case TARGET_CACHED:
      case TARGET_NONCACHED:
        this.m_compositor!.SetBuffer(this.m_mainBuffer);
        break;
      case TARGET_OVERLAY:
        this.m_compositor!.SetBuffer(this.m_overlayBuffer);
        break;
      case TARGET_TEMP:
        this.m_compositor!.SetBuffer(this.m_tempBuffer);
        break;
    }

    this.m_currentTarget = aTarget;
  }

  override GetTarget(): RENDER_TARGET {
    return this.m_currentTarget;
  }

  override ClearTarget(aTarget: RENDER_TARGET): void {
    // Save the current state
    const currentBuffer = this.m_compositor!.GetBuffer();

    switch (aTarget) {
      // Cached and noncached items are rendered to the same buffer
      default:
      case TARGET_CACHED:
      case TARGET_NONCACHED:
        this.m_compositor!.SetBuffer(this.m_mainBuffer);
        break;
      case TARGET_OVERLAY:
        this.m_compositor!.SetBuffer(this.m_overlayBuffer);
        break;
      case TARGET_TEMP:
        this.m_compositor!.SetBuffer(this.m_tempBuffer);
        break;
    }

    this.m_compositor!.ClearBuffer(COLOR4D_BLACK);

    // Restore the previous state
    this.m_compositor!.SetBuffer(currentBuffer);
  }

  /// @copydoc GAL::StartDiffLayer()
  override StartDiffLayer(): void {
    this.SetTarget(TARGET_TEMP);
    this.ClearTarget(TARGET_TEMP);
  }

  /// @copydoc GAL::EndDiffLayer()
  override EndDiffLayer(): void {
    this.m_compositor!.DrawBuffer(
      this.m_tempBuffer,
      this.m_mainBuffer,
      cairo_operator_t.CAIRO_OPERATOR_DIFFERENCE,
    );
  }

  /// @copydoc GAL::StartNegativesLayer()
  override StartNegativesLayer(): void {
    this.SetTarget(TARGET_TEMP);
    this.ClearTarget(TARGET_TEMP);
  }

  /// @copydoc GAL::EndNegativesLayer()
  override EndNegativesLayer(): void {
    this.m_compositor!.DrawBuffer(
      this.m_tempBuffer,
      this.m_mainBuffer,
      cairo_operator_t.CAIRO_OPERATOR_OVER,
    );
  }

  /// @copydoc GAL::SetNativeCursorStyle()
  override SetNativeCursorStyle(aCursor: KICURSOR, aHiDPI: boolean): boolean {
    // Store the current cursor type and get the wx cursor for it
    if (!super.SetNativeCursorStyle(aCursor, aHiDPI)) return false;

    // GAL's constructor calls this before the window is attached.
    this.m_window?.SetCursor(this.m_currentNativeCursor, aHiDPI);

    return true;
  }

  /// Prepare Cairo surfaces for drawing
  initSurface(): void {
    if (this.m_isInitialized) return;

    this.m_surface = cairo_image_surface_create_for_data(
      this.m_bitmapBuffer!.backing,
      CAIRO_GAL_BASE.GAL_FORMAT,
      this.m_wxBufferWidth,
      this.m_screenSize.y,
      this.m_stride,
    );

    this.m_context = cairo_create(this.m_surface);

    this.m_currentContext = this.m_context;

    this.m_isInitialized = true;
  }

  /// Destroy Cairo surfaces when are not needed anymore
  deinitSurface(): void {
    if (!this.m_isInitialized) return;

    cairo_destroy(this.m_context);
    this.m_context = null;
    cairo_surface_destroy(this.m_surface);
    this.m_surface = null;

    this.m_isInitialized = false;
  }

  /// Allocate the bitmaps for drawing
  allocateBitmaps(): void {
    this.m_wxBufferWidth = this.m_screenSize.x;

    // Create buffer, use the system independent Cairo context backend
    this.m_stride = cairo_format_stride_for_width(CAIRO_GAL_BASE.GAL_FORMAT, this.m_wxBufferWidth);
    this.m_bufferSize = this.m_stride * this.m_screenSize.y;

    // m_bitmapBuffer = new unsigned char[m_bufferSize]: a canvas of the client size
    this.m_bitmapBuffer = cairo_image_surface_create(
      CAIRO_GAL_BASE.GAL_FORMAT,
      this.m_wxBufferWidth,
      this.m_screenSize.y,
    );
  }

  /// Delete the bitmaps for drawing
  deleteBitmaps(): void {
    cairo_surface_destroy(this.m_bitmapBuffer);
    this.m_bitmapBuffer = null;
  }

  /// Prepare the compositor
  setCompositor(): void {
    // Recreate the compositor with the new Cairo context
    this.m_compositor = new CAIRO_COMPOSITOR({
      get: () => this.m_currentContext!,
      set: (aContext) => {
        this.m_currentContext = aContext;
      },
    });
    this.m_compositor.Resize(this.m_screenSize.x, this.m_screenSize.y);
    this.m_compositor.SetAntialiasingMode(this.m_options.antialiasing_mode);

    // Prepare buffers
    this.m_mainBuffer = this.m_compositor.CreateBuffer();
    this.m_overlayBuffer = this.m_compositor.CreateBuffer();
    this.m_tempBuffer = this.m_compositor.CreateBuffer();

    this.m_validCompositor = true;
  }

  ///< Cairo-specific update handlers
  protected override updatedGalDisplayOptions(aOptions: GAL_DISPLAY_OPTIONS): boolean {
    let refresh = false;

    if (
      this.m_validCompositor &&
      aOptions.antialiasing_mode !== this.m_compositor!.GetAntialiasingMode()
    ) {
      this.m_compositor!.SetAntialiasingMode(this.m_options.antialiasing_mode);
      this.m_validCompositor = false;
      this.deinitSurface();

      refresh = true;
    }

    if (super.updatedGalDisplayOptions(aOptions)) {
      this.m_window?.Refresh();
      refresh = true;
    }

    return refresh;
  }
}
