// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The GAL `GERBVIEW_PAINTER` (`gerbview/gerbview_painter.ts`) draws through,
 * over the Gerber Viewer's two surfaces: a Canvas 2D context, or the WebGL
 * recorder (`render/gl/recorder.ts`), which both answer the canvas-shaped
 * {@link SURFACE}.
 *
 * Ours, no KiCad file, and interim. Upstream the painter draws on
 * `CAIRO_GAL` or `OPENGL_GAL` inside `GERBVIEW_DRAW_PANEL_GAL`; this viewer
 * still has its own canvas (`GerberCanvas.tsx`), so the painter gets this
 * thin GAL instead. It goes when the canvas becomes GERBVIEW_DRAW_PANEL_GAL
 * over common's VIEW and OPENGL_GAL, as the board editor's already is
 * (gerbview/STRUCTURE.md).
 *
 * Two things it translates:
 *
 * - **the Y axis.** The painter draws in image (AB) coordinates, whose Y runs
 *   down, as every KiCad GAL coordinate does. This canvas's world runs Y up
 *   and flips it in its view transform, so every point is mirrored here.
 * - **negative draw mode.** `CAIRO_GAL::SetNegativeDrawMode` draws with
 *   `CAIRO_OPERATOR_CLEAR`, which erases whatever colour it is given; the
 *   Canvas 2D equivalent is `destination-out` with an opaque source. The GL
 *   recorder has no such mode — `OPENGL_GAL::SetNegativeDrawMode` is `{}` —
 *   and a clear item's colour is transparent there, so nothing is recorded.
 */
import type { Color4d } from '@ziroeda/common/color4d.js';
import type { GLYPH_LIKE, STROKE_GLYPH } from '@ziroeda/common/font/glyph.js';
import { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/**
 * The drawing surface both backends provide.
 *
 * Deliberately not `CanvasRenderingContext2D`: naming that type here would let
 * a call to any of its hundred members compile and then do nothing on the GL
 * path, which is the failure mode this whole port has to avoid - no error,
 * nothing drawn.
 */
export interface SURFACE {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  arc(cx: number, cy: number, r: number, a0: number, a1: number, ccw?: boolean): void;
  fill(): void;
  stroke(): void;
}

/** A Canvas 2D context also composites: the one extra member negative mode needs. */
interface COMPOSITING_SURFACE extends SURFACE {
  globalCompositeOperation: string;
}

const hasCompositing = (s: SURFACE): s is COMPOSITING_SURFACE => 'globalCompositeOperation' in s;

const css = (c: Color4d, alpha = c.a): string =>
  `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${alpha})`;

export class SURFACE_GAL extends GAL {
  private m_negative = false;

  /**
   * @param m_surface the canvas or recorder.
   * @param m_minLineWidthWorld the thinnest stroke, in world units: one device
   *        pixel for the Canvas 2D backend, which has no shader to clamp with;
   *        the GL recorder clamps in its shader and passes its own hairline.
   */
  constructor(
    private m_surface: SURFACE,
    private m_minLineWidthWorld: number,
  ) {
    super(new GAL_DISPLAY_OPTIONS());
  }

  /** The recorder triangulates filled paths itself, so both answer false. */
  override IsOpenGlEngine(): boolean {
    return false;
  }

  override SetNegativeDrawMode(aSetting: boolean): void {
    this.m_negative = aSetting;
  }

  /** AB (Y down) to this canvas's world (Y up). */
  private p(v: Vec2): Vec2 {
    return { x: v.x, y: -v.y };
  }

  /**
   * Set up the surface for a fill or a stroke. False when there is nothing
   * to draw: a transparent colour outside negative mode.
   */
  private begin(aStroke: boolean, aWidth = this.m_lineWidth): boolean {
    const s = this.m_surface;
    const color = aStroke ? this.m_strokeColor : this.m_fillColor;

    if (this.m_negative && hasCompositing(s)) {
      s.globalCompositeOperation = 'destination-out';
      s.fillStyle = css(color, 1);
      s.strokeStyle = css(color, 1);
    } else {
      if (color.a <= 0) return false;
      if (hasCompositing(s)) s.globalCompositeOperation = 'source-over';
      s.fillStyle = css(color);
      s.strokeStyle = css(color);
    }

    s.lineWidth = Math.max(aWidth, this.m_minLineWidthWorld);
    s.lineCap = 'round';
    s.lineJoin = 'round';
    return true;
  }

  /** Close the draw: back to plain compositing. */
  private end(): void {
    const s = this.m_surface;
    if (hasCompositing(s)) s.globalCompositeOperation = 'source-over';
  }

  private path(aPoints: readonly Vec2[], aClosed: boolean): void {
    const s = this.m_surface;
    const first = aPoints[0];

    if (!first) return;

    const a = this.p(first);
    s.moveTo(a.x, a.y);

    for (let i = 1; i < aPoints.length; i++) {
      const b = this.p(aPoints[i] as Vec2);
      s.lineTo(b.x, b.y);
    }

    if (aClosed) s.closePath();
  }

  /**
   * The world-space arc for a GAL arc: a point at angle `t` in AB is at
   * `-t` in this canvas's world, so a sweep of `aAngle` from `aStart` runs
   * from `-aStart` to `-(aStart + aAngle)`, the other way round.
   */
  private arcPath(aCenter: Vec2, aRadius: number, aStart: number, aAngle: number): void {
    const c = this.p(aCenter);
    this.m_surface.arc(c.x, c.y, Math.max(aRadius, 0), -aStart, -(aStart + aAngle), aAngle > 0);
  }

  override DrawLine(aStartPoint: Vec2, aEndPoint: Vec2): void {
    if (!this.begin(true)) return;
    const s = this.m_surface;
    s.beginPath();
    this.path([aStartPoint, aEndPoint], false);
    s.stroke();
    this.end();
  }

  /**
   * A thick segment with round ends: filled as a round-capped stroke; in
   * outline mode the outline of that shape.
   */
  override DrawSegment(aStartPoint: Vec2, aEndPoint: Vec2, aWidth: number): void {
    const s = this.m_surface;

    if (this.m_isFillEnabled) {
      if (!this.begin(false, aWidth)) return;
      s.strokeStyle = s.fillStyle;
      s.beginPath();
      this.path([aStartPoint, aEndPoint], false);
      s.stroke();
      this.end();
      return;
    }

    if (!this.begin(true)) return;
    const r = aWidth / 2;
    const dx = aEndPoint.x - aStartPoint.x;
    const dy = aEndPoint.y - aStartPoint.y;
    const a = Math.atan2(dy, dx);
    s.beginPath();
    this.arcPath(aStartPoint, r, a + Math.PI / 2, Math.PI);
    this.arcPath(aEndPoint, r, a - Math.PI / 2, Math.PI);
    s.closePath();
    s.stroke();
    this.end();
  }

  override DrawPolyline(aPointList: readonly Vec2[] | SHAPE_LINE_CHAIN): void {
    if (!this.begin(true)) return;
    const s = this.m_surface;
    s.beginPath();

    if (aPointList instanceof SHAPE_LINE_CHAIN)
      this.path(aPointList.CPoints(), aPointList.IsClosed());
    else this.path(aPointList, false);

    s.stroke();
    this.end();
  }

  override DrawCircle(aCenterPoint: Vec2, aRadius: number): void {
    const s = this.m_surface;
    const fill = this.m_isFillEnabled;

    if (!this.begin(!fill)) return;

    s.beginPath();
    this.arcPath(aCenterPoint, aRadius, 0, Math.PI * 2);

    if (fill) s.fill();
    else s.stroke();

    this.end();
  }

  /**
   * DrawArcSegment() with fill on is a thick arc with round ends; with fill
   * off, "the outline of what it would have drawn with fill on".
   */
  override DrawArcSegment(
    aCenterPoint: Vec2,
    aRadius: number,
    aStartAngle: EDA_ANGLE,
    aAngle: EDA_ANGLE,
    aWidth: number,
    _aMaxError: number,
  ): void {
    const s = this.m_surface;
    const a0 = aStartAngle.AsRadians();
    const sweep = aAngle.AsRadians();

    if (this.m_isFillEnabled) {
      if (!this.begin(false, aWidth)) return;
      s.strokeStyle = s.fillStyle;
      s.beginPath();
      this.arcPath(aCenterPoint, aRadius, a0, sweep);
      s.stroke();
      this.end();
      return;
    }

    if (!this.begin(true)) return;
    const hw = aWidth / 2;
    const end = a0 + sweep;
    const capAt = (t: number): Vec2 => ({
      x: aCenterPoint.x + aRadius * Math.cos(t),
      y: aCenterPoint.y + aRadius * Math.sin(t),
    });
    s.beginPath();
    this.arcPath(aCenterPoint, aRadius + hw, a0, sweep);
    this.arcPath(capAt(end), hw, end, Math.PI);
    this.arcPath(aCenterPoint, Math.max(aRadius - hw, 0), end, -sweep);
    this.arcPath(capAt(a0), hw, a0 + Math.PI, Math.PI);
    s.closePath();
    s.stroke();
    this.end();
  }

  override DrawRectangle(aStartPoint: Vec2, aEndPoint: Vec2): void {
    const s = this.m_surface;
    const fill = this.m_isFillEnabled;

    if (!this.begin(!fill)) return;

    s.beginPath();
    this.path(
      [
        aStartPoint,
        { x: aEndPoint.x, y: aStartPoint.y },
        aEndPoint,
        { x: aStartPoint.x, y: aEndPoint.y },
      ],
      true,
    );

    if (fill) s.fill();
    else s.stroke();

    this.end();
  }

  override DrawPolygon(aPointList: readonly Vec2[] | SHAPE_LINE_CHAIN): void;
  override DrawPolygon(aPolySet: SHAPE_POLY_SET, aStrokeTriangulation?: boolean): void;
  override DrawPolygon(
    aPoly: readonly Vec2[] | SHAPE_LINE_CHAIN | SHAPE_POLY_SET,
    _aStrokeTriangulation = false,
  ): void {
    const s = this.m_surface;
    const fill = this.m_isFillEnabled;

    if (!this.begin(!fill)) return;

    s.beginPath();

    if (aPoly instanceof SHAPE_POLY_SET) {
      for (let i = 0; i < aPoly.OutlineCount(); i++) {
        this.path(aPoly.COutline(i).CPoints(), true);

        for (let h = 0; h < aPoly.HoleCount(i); h++) this.path(aPoly.CHole(i, h).CPoints(), true);
      }
    } else if (aPoly instanceof SHAPE_LINE_CHAIN) {
      this.path(aPoly.CPoints(), true);
    } else {
      this.path(aPoly, true);
    }

    if (fill) s.fill();
    else s.stroke();

    this.end();
  }

  /** The stroke font's glyphs, which `BitmapText` lays out, as polylines. */
  override DrawGlyph(aGlyph: GLYPH_LIKE, _aNth = 0, _aTotal = 1): void {
    if (!aGlyph.IsStroke()) return;

    for (const pointList of (aGlyph as STROKE_GLYPH).strokes) this.DrawPolyline(pointList);
  }
}
