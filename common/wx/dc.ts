// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `wxDC` for a browser: a device context on a page-sized canvas, as far as
 * KiCad's wxDC print path calls it (`common/gr_basic.cpp`, `gr_text.cpp`,
 * `BITMAP_BASE::DrawBitmap`, the drawing sheet's `PrintWsItem`s and
 * `wxPrintout`'s page fitting).
 *
 * The coordinate mapping is wx's, and measured, not recalled
 * (`qa/probes/printout_fit_probe.cpp`): a logical coordinate is offset by the
 * logical origin, scaled by the user scale in double, rounded to a whole
 * device unit, and offset by the device origin; `DeviceToLogical` is the
 * inverse, rounded again; the `Rel` forms scale and round only.
 *
 * What is recalled rather than measured, because GTK will not run a print
 * operation without a printer here: the printer DC strokes a pen `width`
 * logical units wide - scaled like everything else, not a whole device unit -
 * with the round cap and join a default `wxPen` has (peninfobase.h:110-111),
 * and draws an arc counter-clockwise, as `wxDC::DrawArc` is documented to.
 * `wxGtkPrinterDCImpl` does not override `CanUseTransformMatrix`, so it is
 * `wxDCImpl`'s `false` (gtk/print.h:214-312, dc.h:540).
 */

import { type Color4d, COLOR4D_BLACK, toCss } from '../color4d.js';
import type { CANVAS_2D } from '../gal/cairo/cairo_api.js';
import type { WX_IMAGE } from './wx_image.js';

export enum wxPenStyle {
  wxPENSTYLE_INVALID = -1,
  wxPENSTYLE_SOLID = 100,
  wxPENSTYLE_DOT,
  wxPENSTYLE_LONG_DASH,
  wxPENSTYLE_SHORT_DASH,
  wxPENSTYLE_DOT_DASH,
  wxPENSTYLE_USER_DASH,
  wxPENSTYLE_TRANSPARENT,
}

export enum wxBrushStyle {
  wxBRUSHSTYLE_INVALID = -1,
  wxBRUSHSTYLE_SOLID = 100,
  wxBRUSHSTYLE_TRANSPARENT = 106,
}

/** `wxPen`: the colour, width, style and dashes GRSetColorPen gives it. */
export class wxPen {
  private m_ok: boolean;
  private m_colour: Color4d = COLOR4D_BLACK;
  private m_width = 1;
  private m_style = wxPenStyle.wxPENSTYLE_SOLID;
  private m_dashes: number[] = [];

  /** `wxPen()` is not Ok until something is set; `wxPen( colour, width )` is. */
  constructor(aColour?: Color4d, aWidth = 1, aStyle = wxPenStyle.wxPENSTYLE_SOLID) {
    this.m_ok = aColour !== undefined;
    if (aColour) this.m_colour = aColour;
    this.m_width = aWidth;
    this.m_style = aStyle;
  }

  IsOk(): boolean {
    return this.m_ok;
  }

  GetColour(): Color4d {
    return this.m_colour;
  }

  SetColour(aColour: Color4d): void {
    this.m_colour = aColour;
    this.m_ok = true;
  }

  GetWidth(): number {
    return this.m_width;
  }

  SetWidth(aWidth: number): void {
    this.m_width = aWidth;
    this.m_ok = true;
  }

  GetStyle(): wxPenStyle {
    return this.m_style;
  }

  SetStyle(aStyle: wxPenStyle): void {
    this.m_style = aStyle;
    this.m_ok = true;
  }

  SetDashes(aDashes: readonly number[]): void {
    this.m_dashes = [...aDashes];
  }

  GetDashes(): readonly number[] {
    return this.m_dashes;
  }
}

/** `wxBrush`: a colour, solid or transparent. */
export class wxBrush {
  private m_colour: Color4d = COLOR4D_BLACK;
  private m_style = wxBrushStyle.wxBRUSHSTYLE_SOLID;

  GetColour(): Color4d {
    return this.m_colour;
  }

  SetColour(aColour: Color4d): void {
    this.m_colour = aColour;
  }

  GetStyle(): wxBrushStyle {
    return this.m_style;
  }

  SetStyle(aStyle: wxBrushStyle): void {
    this.m_style = aStyle;
  }
}

export interface wxPoint {
  x: number;
  y: number;
}

/** `wxRound`: to the nearest integer, halves away from zero. */
/** An int has no negative zero, so neither does this. */
export const wxRound = (x: number): number => (x < 0 ? -Math.round(-x) : Math.round(x)) + 0;

/**
 * The page canvas' 2D context: the cairo layer's `CANVAS_2D`, which
 * `CAIRO_PRINT_GAL` draws the same page with, and the two calls only a wxDC
 * makes.
 */
type WX_DC_2D = CANVAS_2D & Partial<Pick<CanvasRenderingContext2D, 'ellipse' | 'setLineDash'>>;

export class wxDC {
  readonly ctx: WX_DC_2D;
  readonly image: CanvasImageSource;
  private readonly m_width: number;
  private readonly m_height: number;
  private readonly m_ppi: number;

  private m_userScaleX = 1;
  private m_userScaleY = 1;
  private m_logicalOriginX = 0;
  private m_logicalOriginY = 0;
  private m_deviceOriginX = 0;
  private m_deviceOriginY = 0;
  private m_signX = 1;
  private m_signY = 1;

  private m_pen = new wxPen();
  private m_brush = new wxBrush();

  /**
   * @param aCtx is the page's 2D context and `aImage` the canvas behind it.
   * @param aSize is the page in device units, `aPPI` their density.
   */
  constructor(
    aCtx: WX_DC_2D,
    aImage: CanvasImageSource,
    aSize: { x: number; y: number },
    aPPI: number,
  ) {
    this.ctx = aCtx;
    this.image = aImage;
    this.m_width = aSize.x;
    this.m_height = aSize.y;
    this.m_ppi = aPPI;
  }

  /** `GetSize()`: the page, in device units. */
  GetSize(): { x: number; y: number } {
    return { x: this.m_width, y: this.m_height };
  }

  /** `GetPPI()`: device units per inch, the same on both axes. */
  GetPPI(): number {
    return this.m_ppi;
  }

  // ---- the coordinate system --------------------------------------------------

  SetUserScale(x: number, y: number): void {
    this.m_userScaleX = x;
    this.m_userScaleY = y;
  }

  GetUserScale(): { x: number; y: number } {
    return { x: this.m_userScaleX, y: this.m_userScaleY };
  }

  SetLogicalOrigin(x: number, y: number): void {
    this.m_logicalOriginX = x;
    this.m_logicalOriginY = y;
  }

  GetLogicalOrigin(): wxPoint {
    return { x: this.m_logicalOriginX, y: this.m_logicalOriginY };
  }

  SetDeviceOrigin(x: number, y: number): void {
    this.m_deviceOriginX = x;
    this.m_deviceOriginY = y;
  }

  GetDeviceOrigin(): wxPoint {
    return { x: this.m_deviceOriginX, y: this.m_deviceOriginY };
  }

  SetAxisOrientation(aXLeftRight: boolean, aYBottomUp: boolean): void {
    this.m_signX = aXLeftRight ? 1 : -1;
    this.m_signY = aYBottomUp ? -1 : 1;
  }

  /** `wxDC::CanUseTransformMatrix()`: a printer DC cannot (dc.h:540). */
  CanUseTransformMatrix(): boolean {
    return false;
  }

  LogicalToDeviceX(x: number): number {
    return (
      wxRound((x - this.m_logicalOriginX) * this.m_signX * this.m_userScaleX) + this.m_deviceOriginX
    );
  }

  LogicalToDeviceY(y: number): number {
    return (
      wxRound((y - this.m_logicalOriginY) * this.m_signY * this.m_userScaleY) + this.m_deviceOriginY
    );
  }

  LogicalToDeviceXRel(x: number): number {
    return wxRound(x * this.m_userScaleX);
  }

  LogicalToDeviceYRel(y: number): number {
    return wxRound(y * this.m_userScaleY);
  }

  DeviceToLogicalX(x: number): number {
    return (
      wxRound((x - this.m_deviceOriginX) / this.m_userScaleX) * this.m_signX + this.m_logicalOriginX
    );
  }

  DeviceToLogicalY(y: number): number {
    return (
      wxRound((y - this.m_deviceOriginY) / this.m_userScaleY) * this.m_signY + this.m_logicalOriginY
    );
  }

  DeviceToLogicalXRel(x: number): number {
    return wxRound(x / this.m_userScaleX);
  }

  DeviceToLogicalYRel(y: number): number {
    return wxRound(y / this.m_userScaleY);
  }

  // ---- pen and brush ----------------------------------------------------------

  SetPen(aPen: wxPen): void {
    this.m_pen = aPen;
  }

  GetPen(): wxPen {
    return this.m_pen;
  }

  SetBrush(aBrush: wxBrush): void {
    this.m_brush = aBrush;
  }

  GetBrush(): wxBrush {
    return this.m_brush;
  }

  // ---- drawing ------------------------------------------------------------------

  private stroking(): boolean {
    return this.m_pen.IsOk() && this.m_pen.GetStyle() !== wxPenStyle.wxPENSTYLE_TRANSPARENT;
  }

  private filling(): boolean {
    return this.m_brush.GetStyle() === wxBrushStyle.wxBRUSHSTYLE_SOLID;
  }

  private applyPen(): void {
    const ctx = this.ctx;
    const scale = Math.abs(this.m_userScaleX);
    ctx.strokeStyle = toCss(this.m_pen.GetColour());
    ctx.lineWidth = Math.max(this.m_pen.GetWidth(), 0) * scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (this.m_pen.GetStyle() === wxPenStyle.wxPENSTYLE_USER_DASH) {
      // A dash is in units of the pen width, as wxPen::SetDashes documents.
      const w = Math.max(ctx.lineWidth, 1);
      ctx.setLineDash?.(this.m_pen.GetDashes().map((d) => d * w));
    } else {
      ctx.setLineDash?.([]);
    }
  }

  private dev(x: number, y: number): [number, number] {
    return [this.LogicalToDeviceX(x), this.LogicalToDeviceY(y)];
  }

  DrawLine(x1: number, y1: number, x2: number, y2: number): void;
  DrawLine(aStart: wxPoint, aEnd: wxPoint): void;
  DrawLine(a: number | wxPoint, b: number | wxPoint, c?: number, d?: number): void {
    const [x1, y1, x2, y2] =
      typeof a === 'number'
        ? [a, b as number, c!, d!]
        : [a.x, a.y, (b as wxPoint).x, (b as wxPoint).y];

    if (!this.stroking()) return;

    const ctx = this.ctx;
    this.applyPen();
    ctx.beginPath();
    ctx.moveTo(...this.dev(x1, y1));
    ctx.lineTo(...this.dev(x2, y2));
    ctx.stroke();
  }

  /** `DrawPolygon( n, points )`, filled by the odd-even rule wx defaults to. */
  DrawPolygon(aPoints: readonly wxPoint[]): void {
    if (aPoints.length === 0) return;

    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(...this.dev(aPoints[0]!.x, aPoints[0]!.y));

    for (let i = 1; i < aPoints.length; ++i) ctx.lineTo(...this.dev(aPoints[i]!.x, aPoints[i]!.y));

    ctx.closePath();

    if (this.filling()) {
      ctx.fillStyle = toCss(this.m_brush.GetColour());
      ctx.fill('evenodd');
    }

    if (this.stroking()) {
      this.applyPen();
      ctx.stroke();
    }
  }

  /**
   * `DrawArc( x1, y1, x2, y2, xc, yc )`: counter-clockwise from the first
   * point to the second around the centre; a whole circle when they coincide;
   * a pie when the brush fills.
   */
  DrawArc(x1: number, y1: number, x2: number, y2: number, xc: number, yc: number): void;
  DrawArc(aStart: wxPoint, aEnd: wxPoint, aCentre: wxPoint): void;
  DrawArc(
    a: number | wxPoint,
    b: number | wxPoint,
    c: number | wxPoint,
    d?: number,
    e?: number,
    f?: number,
  ): void {
    const [x1, y1, x2, y2, xc, yc] =
      typeof a === 'number'
        ? [a, b as number, c as number, d!, e!, f!]
        : [a.x, a.y, (b as wxPoint).x, (b as wxPoint).y, (c as wxPoint).x, (c as wxPoint).y];

    const [dxc, dyc] = this.dev(xc, yc);
    const [dx1, dy1] = this.dev(x1, y1);
    const [dx2, dy2] = this.dev(x2, y2);
    const radius = Math.hypot(dx1 - dxc, dy1 - dyc);
    const a1 = Math.atan2(dy1 - dyc, dx1 - dxc);
    const full = x1 === x2 && y1 === y2;
    const a2 = full ? a1 - 2 * Math.PI : Math.atan2(dy2 - dyc, dx2 - dxc);

    const ctx = this.ctx;
    ctx.beginPath();

    if (this.filling()) ctx.moveTo(dxc, dyc);

    // Counter-clockwise as it is seen: device y runs down, so `anticlockwise`.
    ctx.arc(dxc, dyc, radius, a1, a2, true);

    if (this.filling()) {
      ctx.closePath();
      ctx.fillStyle = toCss(this.m_brush.GetColour());
      ctx.fill();
    }

    if (this.stroking()) {
      this.applyPen();
      ctx.stroke();
    }
  }

  /** `DrawEllipse( x, y, width, height )`: the box, logical. */
  DrawEllipse(x: number, y: number, aWidth: number, aHeight: number): void {
    const [dx, dy] = this.dev(x, y);
    const dw = this.LogicalToDeviceXRel(aWidth);
    const dh = this.LogicalToDeviceYRel(aHeight);
    const ctx = this.ctx;

    ctx.beginPath();

    if (ctx.ellipse)
      ctx.ellipse(dx + dw / 2, dy + dh / 2, Math.abs(dw / 2), Math.abs(dh / 2), 0, 0, 2 * Math.PI);
    else ctx.arc(dx + dw / 2, dy + dh / 2, Math.abs(dw / 2), 0, 2 * Math.PI);

    if (this.filling()) {
      ctx.fillStyle = toCss(this.m_brush.GetColour());
      ctx.fill();
    }

    if (this.stroking()) {
      this.applyPen();
      ctx.stroke();
    }
  }

  /**
   * `DrawBitmap( bitmap, x, y, useMask )`: the image with its top left at the
   * logical point, one bitmap pixel to one logical unit.
   */
  DrawBitmap(aImage: WX_IMAGE, x: number, y: number, _aUseMask = true): void {
    const w = aImage.GetWidth();
    const h = aImage.GetHeight();
    const rgb = aImage.GetData();

    if (!rgb || w <= 0 || h <= 0) return;

    const alpha = aImage.GetAlpha();
    const rgba = new Uint8ClampedArray(w * h * 4);

    for (let i = 0; i < w * h; ++i) {
      rgba[i * 4] = rgb[i * 3]!;
      rgba[i * 4 + 1] = rgb[i * 3 + 1]!;
      rgba[i * 4 + 2] = rgb[i * 3 + 2]!;
      rgba[i * 4 + 3] = alpha ? alpha[i]! : 255;
    }

    const tile =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(w, h)
        : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const tctx = tile.getContext('2d') as CanvasRenderingContext2D | null;

    if (!tctx) return;

    tctx.putImageData(new ImageData(rgba, w, h), 0, 0);

    const [dx, dy] = this.dev(x, y);
    this.ctx.drawImage(
      tile as CanvasImageSource,
      dx,
      dy,
      this.LogicalToDeviceXRel(w),
      this.LogicalToDeviceYRel(h),
    );
  }
}
