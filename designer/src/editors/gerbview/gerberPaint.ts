// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GERBVIEW_PAINTER::draw`, backend-agnostic.
 *
 * This is the split KiCad already has and we did not. Upstream, GerbView owns
 * exactly one renderer-facing class - GERBVIEW_PAINTER - which turns a
 * GERBER_DRAW_ITEM into GAL calls, and the GAL underneath it is either Cairo or
 * OpenGL (`gerbview/gerbview_draw_panel_gal.cpp`). Nothing about the painter
 * changes between them. Everything else GerbView draws with is pcbnew's too:
 * the same KIGFX::VIEW, the same EDA_DRAW_PANEL_GAL, the same OPENGL_GAL.
 *
 * We had the painter welded to Canvas2D inside `gerberRender.ts`, so putting
 * GerbView on the shared GL layer looked like writing a second painter. It is
 * not: it is giving this one a second surface. `SURFACE` is the subset of
 * CanvasRenderingContext2D that both a real 2D context and `render/gl`'s
 * GlRecorder provide, which is how the same code records vertices or paints
 * pixels without knowing which.
 *
 * What deliberately does NOT live here is compositing. Clear (LPC) objects,
 * negative images and the per-layer buffers are Cairo-only concepts:
 * `OPENGL_GAL::SetNegativeDrawMode` is `{}`, an empty override
 * (`include/gal/opengl/opengl_gal.h:273`), and StartNegativesLayer /
 * EndNegativesLayer are overridden only by CAIRO_GAL. On the accelerated
 * canvas - GerbView's default - a clear object is simply given
 * `COLOR4D( 0, 0, 0, 0 )` by GetColor and draws nothing. So the caller decides
 * that, and the two callers legitimately differ.
 */

import { GBR_BASIC_SHAPE, type GERBER_DRAW_ITEM, type AmResolvedShape } from '@ziroeda/gerbview';

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

/** The display options the painter itself reads (GBR_DISPLAY_OPTIONS). */
export interface GerberPaintOptions {
  /** `!m_DisplayFlashedItemsFill` - flashed spots as outlines. */
  flashedSketch: boolean;
  /** `!m_DisplayLinesFill`. */
  linesSketch: boolean;
  /** `!m_DisplayPolygonsFill`. */
  polygonsSketch: boolean;
}

function fillCircle(s: SURFACE, cx: number, cy: number, r: number): void {
  s.beginPath();
  s.arc(cx, cy, Math.max(r, 0), 0, Math.PI * 2);
  s.fill();
}

function fillPolygon(s: SURFACE, pts: readonly { x: number; y: number }[]): void {
  if (pts.length < 2) return;
  s.beginPath();
  s.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i]!.x, pts[i]!.y);
  s.closePath();
  s.fill();
}

/**
 * `GAL::DrawSegment( start, end, width )` - a round-capped thick line, which is
 * a stroke of that width on both backends.
 */
function fillCapsule(
  s: SURFACE,
  a: { x: number; y: number },
  b: { x: number; y: number },
  width: number,
): void {
  s.lineCap = 'round';
  s.lineJoin = 'round';
  s.lineWidth = Math.max(width, 0);
  s.beginPath();
  s.moveTo(a.x, a.y);
  s.lineTo(b.x, b.y);
  s.stroke();
}

/** One resolved aperture primitive, filled or outlined. */
export function paintResolvedShape(s: SURFACE, sh: AmResolvedShape, sketch: boolean): void {
  if (sketch) {
    if (sh.kind === 'circle') {
      s.beginPath();
      s.arc(sh.center.x, sh.center.y, Math.max(sh.radius, 0), 0, Math.PI * 2);
      s.stroke();
    } else if (sh.kind === 'segment') {
      s.lineCap = 'round';
      s.beginPath();
      s.moveTo(sh.a.x, sh.a.y);
      s.lineTo(sh.b.x, sh.b.y);
      s.stroke();
    } else if (sh.points.length > 0) {
      s.beginPath();
      s.moveTo(sh.points[0]!.x, sh.points[0]!.y);
      for (let i = 1; i < sh.points.length; i++) s.lineTo(sh.points[i]!.x, sh.points[i]!.y);
      s.closePath();
      s.stroke();
    }
    return;
  }
  if (sh.kind === 'circle') fillCircle(s, sh.center.x, sh.center.y, sh.radius);
  else if (sh.kind === 'segment') fillCapsule(s, sh.a, sh.b, sh.width);
  else fillPolygon(s, sh.points);
}

/**
 * Paint one item's geometry. Colour and compositing are the caller's; this
 * draws the shape and nothing else, which is what makes it shareable.
 *
 * `worldPen` stands in for `m_gerbviewSettings.m_outlineWidth`, which is 1 IU
 * (`common/render_settings.cpp:43`) and therefore invisible - upstream's
 * outlines are a hairline, so the caller passes the width that means "one
 * device pixel" for its backend.
 */
export function paintItemGeometry(
  s: SURFACE,
  item: GERBER_DRAW_ITEM,
  opts: GerberPaintOptions,
  worldPen: number,
): void {
  switch (item.shape) {
    case GBR_BASIC_SHAPE.GBR_SEGMENT: {
      if (opts.linesSketch) {
        s.lineWidth = worldPen;
        s.lineCap = 'round';
        s.beginPath();
        s.moveTo(item.start.x, item.start.y);
        s.lineTo(item.end.x, item.end.y);
        s.stroke();
      } else {
        fillCapsule(s, item.start, item.end, item.width);
      }
      break;
    }
    case GBR_BASIC_SHAPE.GBR_ARC:
    case GBR_BASIC_SHAPE.GBR_CIRCLE: {
      const r = Math.hypot(item.start.x - item.arcCentre.x, item.start.y - item.arcCentre.y);
      s.lineWidth = opts.linesSketch ? worldPen : Math.max(item.width, worldPen);
      s.lineCap = 'round';
      s.beginPath();
      if (item.shape === GBR_BASIC_SHAPE.GBR_CIRCLE) {
        s.arc(item.arcCentre.x, item.arcCentre.y, r, 0, Math.PI * 2);
      } else {
        const a0 = Math.atan2(item.start.y - item.arcCentre.y, item.start.x - item.arcCentre.x);
        const a1 = Math.atan2(item.end.y - item.arcCentre.y, item.end.x - item.arcCentre.x);
        s.arc(item.arcCentre.x, item.arcCentre.y, r, a0, a1, item.arcCcw);
      }
      s.stroke();
      break;
    }
    case GBR_BASIC_SHAPE.GBR_POLYGON: {
      if (opts.polygonsSketch) {
        s.lineWidth = worldPen;
        if (item.polyPoints.length > 0) {
          s.beginPath();
          s.moveTo(item.polyPoints[0]!.x, item.polyPoints[0]!.y);
          for (let i = 1; i < item.polyPoints.length; i++)
            s.lineTo(item.polyPoints[i]!.x, item.polyPoints[i]!.y);
          s.closePath();
        }
        s.stroke();
      } else {
        fillPolygon(s, item.polyPoints);
      }
      break;
    }
    default: {
      // A flashed spot: the aperture resolved into primitives. Cached on the
      // item, as m_AbsolutePolygon is upstream.
      if (opts.flashedSketch) s.lineWidth = worldPen;
      for (const sh of item.resolveFlashShapes()) {
        // Exposure-off primitives are holes cut by a polygon boolean upstream
        // (APERTURE_MACRO::GetApertureMacroShape's BooleanSubtract), not by
        // compositing. The caller decides what to do with them.
        if (!sh.exposure) continue;
        paintResolvedShape(s, sh, opts.flashedSketch);
      }
      break;
    }
  }
}
