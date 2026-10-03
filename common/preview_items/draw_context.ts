// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIGFX::PREVIEW::DRAW_CONTEXT` — the pen every drawing assistant draws its
 * guides with. Counterpart: `common/preview_items/draw_context.cpp`.
 *
 * It is one pen, deliberately: `m_currLayer` is `LAYER_AUX_ITEMS` and
 * `m_lineWidth` is `1.0f`, fixed in the constructor and never set by a caller.
 * That is why the arc's radius lines, the circle tool's radius line and the
 * bezier's control arms are all the same hairline in the same colour, and why
 * a guide drawn at the shape's own stroke width is wrong however good it looks.
 *
 * ### The width really is one pixel
 *
 * `m_lineWidth = 1.0f` is passed to `gal.SetLineWidth`, which is a *world*
 * width — but the GAL vertex shader turns it into
 * `max( 1, round( w / u_worldPixelSize ) )` device pixels, and one internal
 * unit is far below a pixel at any usable zoom. So it floors to one device
 * pixel and stays there. Drawing in device space is that answer stated
 * directly.
 *
 * ### The de-emphasis and the special-angle colour
 *
 * Every method takes `aDeEmphasised`, which is `PreviewOverlayDeemphAlpha` —
 * alpha 0.5. `DrawLineWithAngleHighlight` additionally turns **green** when the
 * line lands on a multiple of 45°, which is the only feedback the arc tool
 * gives that a radius is square-on.
 */

import { cssWithAlpha } from '../gal/color4d.js';
import { galPenWidth } from '../gal_pixel_grid.js';
import { previewOverlayDeemphAlpha } from './preview_utils.js';
import type { Color4d } from '../gal/color4d.js';
import type { GAL } from '../gal/graphics_abstraction_layer.js';
import { GAL_LAYER_ID } from '../layer_id.js';
import type { RENDER_SETTINGS } from '../render_settings.js';
import type { VIEW } from '../view/view.js';
import { EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import {
  add,
  EuclideanNormI,
  ResizeI,
  sub,
  type VECTOR2I,
} from '@ziroeda/kimath/src/math/vector2.js';

/** A point in DEVICE pixels. */
export interface DevicePoint {
  x: number;
  y: number;
}

export interface DrawContextOptions {
  /** `GetLayerColor( LAYER_AUX_ITEMS )`, the context's only colour. */
  color: string;
  /** Whether the theme's background is dark, for {@link specialAngleColour}. */
  backgroundIsDark: boolean;
  devicePixelRatio: number;
}

/** `ANGLE_EPSILON` (`draw_context.cpp:33`). */
const ANGLE_EPSILON = 1e-9;

/**
 * `angleIsSpecial`: `fabs( remainder( angle.AsRadians(), M_PI_4 ) ) < eps` —
 * any multiple of 45°, including the axes.
 */
export function angleIsSpecial(radians: number): boolean {
  const q = Math.PI / 4;
  // `std::remainder`: the IEEE remainder, which rounds the quotient to nearest
  // (ties to even) rather than truncating like `%`.
  const n = Math.round(radians / q);
  return Math.abs(radians - n * q) < ANGLE_EPSILON;
}

/**
 * `DRAW_CONTEXT::getSpecialAngleColour` (`draw_context.cpp:136-140`):
 * `COLOR4D( 0.5, 1.0, 0.5 )` on a dark background, `COLOR4D( 0.0, 0.7, 0.0 )`
 * on a light one.
 */
export function specialAngleColour(backgroundIsDark: boolean): string {
  // [data] `draw_context.cpp:138-139`, the two literals upstream hardcodes.
  return backgroundIsDark ? 'rgb(128, 255, 128)' : 'rgb(0, 179, 0)';
}

/** `DRAW_CONTEXT`, drawing in device space onto a 2D context. */
export class DrawContext {
  private readonly ctx_: CanvasRenderingContext2D;
  private readonly o_: DrawContextOptions;

  constructor(ctx: CanvasRenderingContext2D, options: DrawContextOptions) {
    this.ctx_ = ctx;
    this.o_ = options;
  }

  /** `m_lineWidth = 1.0f`, floored to a whole device pixel by the GAL shader. */
  private pen(color: string, deEmphasised: boolean): void {
    const ctx = this.ctx_;
    ctx.lineWidth = galPenWidth(this.o_.devicePixelRatio);
    ctx.strokeStyle = cssWithAlpha(color, previewOverlayDeemphAlpha(deEmphasised));
    ctx.setLineDash([]);
  }

  /** `DrawLine`. */
  drawLine(a: DevicePoint, b: DevicePoint, deEmphasised: boolean): void {
    const ctx = this.ctx_;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.pen(this.o_.color, deEmphasised);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * `DrawLineWithAngleHighlight`: the same line, in
   * {@link specialAngleColour} when it lies on a multiple of 45°.
   *
   * The angle is taken from the vector as given, so pass device-space points:
   * a 45° line on screen is what the highlight is telling the user about.
   */
  drawLineWithAngleHighlight(a: DevicePoint, b: DevicePoint, deEmphasised: boolean): void {
    const ctx = this.ctx_;
    const vec = { x: b.x - a.x, y: b.y - a.y };
    const color = angleIsSpecial(Math.atan2(vec.y, vec.x))
      ? specialAngleColour(this.o_.backgroundIsDark)
      : this.o_.color;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.pen(color, deEmphasised);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * `DrawCircle`: stroked, never filled — `SetIsFill( false )` is explicit
   * here where the other methods leave it alone.
   */
  drawCircle(centre: DevicePoint, radiusPx: number, deEmphasised: boolean): void {
    const ctx = this.ctx_;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.pen(this.o_.color, deEmphasised);
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, Math.abs(radiusPx), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * `DrawLineDashed( start, end, aDashStep, aDashFill, deEmph )`: `aDashFill`
   * on, `aDashStep - aDashFill` off, both in the caller's units — device
   * pixels here, as `BEZIER_ASSISTANT` passes `ToWorld( 12 )` and half of it.
   */
  drawLineDashed(
    a: DevicePoint,
    b: DevicePoint,
    dashStep: number,
    dashFill: number,
    deEmphasised: boolean,
  ): void {
    const ctx = this.ctx_;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.pen(this.o_.color, deEmphasised);
    ctx.setLineDash([dashFill, Math.max(0, dashStep - dashFill)]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
}

/** `angleIsSpecial( EDA_ANGLE )`: a multiple of 45 degrees. */
function angleIsSpecialEda(aAngle: EDA_ANGLE): boolean {
  const r = aAngle.AsRadians();
  // std::remainder: the remainder to the NEAREST multiple, so -pi/8..pi/8.
  return Math.abs(r - Math.round(r / (Math.PI / 4)) * (Math.PI / 4)) < ANGLE_EPSILON;
}

/** `deemphasise( aColor, aDeEmphasised )`. */
function deemphasise(aColor: Color4d, aDeEmphasised: boolean): Color4d {
  return { ...aColor, a: previewOverlayDeemphAlpha(aDeEmphasised) };
}

/**
 * `KIGFX::PREVIEW::DRAW_CONTEXT` (common/preview_items/draw_context.cpp): the
 * preview items' drawing on the VIEW's GAL, in the current layer's colour
 * (LAYER_AUX_ITEMS), a line 1.0 wide, with the de-emphasis and the special-
 * angle green the assistants use. `DrawArcWithAngleHighlight` is declared
 * upstream and never defined, so it is not here either.
 */
export class DRAW_CONTEXT {
  private readonly m_gal: GAL;
  private readonly m_render_settings: RENDER_SETTINGS;
  private readonly m_currLayer: number = GAL_LAYER_ID.LAYER_AUX_ITEMS;
  private readonly m_lineWidth = 1.0;

  constructor(aView: VIEW) {
    this.m_gal = aView.GetGAL()!;
    this.m_render_settings = aView.GetPainter()!.GetSettings();
  }

  DrawCircle(aOrigin: VECTOR2I, aRad: number, aDeEmphasised: boolean): void {
    const color = this.m_render_settings.GetLayerColor(this.m_currLayer);

    this.m_gal.SetLineWidth(this.m_lineWidth);
    this.m_gal.SetStrokeColor(deemphasise(color, aDeEmphasised));
    this.m_gal.SetIsStroke(true);
    this.m_gal.SetIsFill(false);
    this.m_gal.DrawCircle(aOrigin, aRad);
  }

  DrawCircleDashed(
    aOrigin: VECTOR2I,
    aRad: number,
    aStepAngle: number,
    aFillAngle: number,
    aDeEmphasised: boolean,
  ): void {
    const color = this.m_render_settings.GetLayerColor(this.m_currLayer);

    this.m_gal.SetLineWidth(this.m_lineWidth);
    this.m_gal.SetStrokeColor(deemphasise(color, aDeEmphasised));
    this.m_gal.SetIsStroke(true);
    this.m_gal.SetIsFill(false);

    for (let i = 0; i < 360; i += aStepAngle) {
      this.m_gal.DrawArc(
        aOrigin,
        aRad,
        new EDA_ANGLE(i, EDA_ANGLE_T.DEGREES_T),
        new EDA_ANGLE(i + aFillAngle, EDA_ANGLE_T.DEGREES_T),
      );
    }
  }

  DrawLine(aStart: VECTOR2I, aEnd: VECTOR2I, aDeEmphasised: boolean): void {
    const strokeColor = this.m_render_settings.GetLayerColor(this.m_currLayer);

    this.m_gal.SetLineWidth(this.m_lineWidth);
    this.m_gal.SetIsStroke(true);
    this.m_gal.SetStrokeColor(deemphasise(strokeColor, aDeEmphasised));
    this.m_gal.DrawLine(aStart, aEnd);
  }

  DrawLineDashed(
    aStart: VECTOR2I,
    aEnd: VECTOR2I,
    aDashStep: number,
    aDashFill: number,
    aDeEmphasised: boolean,
  ): void {
    const strokeColor = this.m_render_settings.GetLayerColor(this.m_currLayer);

    this.m_gal.SetLineWidth(this.m_lineWidth);
    this.m_gal.SetIsStroke(true);
    this.m_gal.SetStrokeColor(deemphasise(strokeColor, aDeEmphasised));

    const delta = sub(aEnd, aStart);
    // `int vecLen = delta.EuclideanNorm()`: VECTOR2I's norm is an int.
    const vecLen = EuclideanNormI(delta);

    for (let i = 0; i < vecLen; i += aDashStep) {
      const a = add(aStart, ResizeI(delta, i));
      const b = add(aStart, ResizeI(delta, Math.min(i + aDashFill, vecLen)));

      this.m_gal.DrawLine(a, b);
    }
  }

  DrawLineWithAngleHighlight(aStart: VECTOR2I, aEnd: VECTOR2I, aDeEmphasised: boolean): void {
    const vec = sub(aEnd, aStart);
    let strokeColor = this.m_render_settings.GetLayerColor(this.m_currLayer);

    if (angleIsSpecialEda(EDA_ANGLE.fromVector(vec))) strokeColor = this.getSpecialAngleColour();

    this.m_gal.SetLineWidth(this.m_lineWidth);
    this.m_gal.SetIsStroke(true);
    this.m_gal.SetStrokeColor(deemphasise(strokeColor, aDeEmphasised));
    this.m_gal.DrawLine(aStart, aEnd);
  }

  private getSpecialAngleColour(): Color4d {
    // [data] draw_context.cpp's own two literals.
    return this.m_render_settings.IsBackgroundDark()
      ? { r: 0.5, g: 1.0, b: 0.5, a: 1.0 }
      : { r: 0.0, g: 0.7, b: 0.0, a: 1.0 };
  }
}
