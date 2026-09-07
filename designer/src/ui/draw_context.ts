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

import { cssWithAlpha } from '@ziroeda/common/src/color4d.js';
import { galPenWidth } from '@ziroeda/common/src/gal_pixel_grid.js';
import { previewOverlayDeemphAlpha } from './preview_utils.js';

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
