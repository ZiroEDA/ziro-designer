// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/gr_basic.h` + `common/gr_basic.cpp`: the primitives KiCad's wxDC
 * drawing path draws with - lines, segments, polygons, circles, arcs,
 * rectangles - each setting the DC's pen and brush first, and all of them
 * black while `GRForceBlackPen( true )` is in force (printing).
 *
 * The statics are the C++'s: the last move-to point, the forced black pen, and
 * the brush cache that skips a `SetBrush` the DC already has.
 */

import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { type Color4d, COLOR4D_BLACK, COLOR4D_UNSPECIFIED } from './color4d.js';
import { wxBrush, wxBrushStyle, type wxDC, wxPen, wxPenStyle } from './wx/dc.js';

export const FILLED = true;
export const NOT_FILLED = false;

let GRLastMoveToX = 0;
let GRLastMoveToY = 0;
let s_ForceBlackPen = false; /* if true: draws in black instead of color for printing. */
let s_DC_lastbrushcolor: Color4d = { r: 0, g: 0, b: 0, a: 0 };
let s_DC_lastbrushfill = false;
let s_DC_lastDC: wxDC | null = null;

/** `COLOR4D::operator==`. */
const colorEq = (a: Color4d, b: Color4d): boolean =>
  a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

function vector2IwxDrawPolygon(aDC: wxDC, Points: readonly VECTOR2I[], n: number): void {
  aDC.DrawPolygon(Points.slice(0, n).map((p) => ({ x: p.x, y: p.y })));
}

function winDrawLine(DC: wxDC, x1: number, y1: number, x2: number, y2: number, _width: number) {
  GRLastMoveToX = x2;
  GRLastMoveToY = y2;
  DC.DrawLine(x1, y1, x2, y2);
}

export function GRResetPenAndBrush(DC: wxDC): void {
  GRSetBrush(DC, COLOR4D_BLACK); // Force no fill
  s_DC_lastbrushcolor = COLOR4D_UNSPECIFIED;
  s_DC_lastDC = null;
}

/**
 * Set a pen style, width, color, and alpha into the given device context.
 */
export function GRSetColorPen(
  DC: wxDC,
  Color: Color4d,
  width = 1,
  style: wxPenStyle = wxPenStyle.wxPENSTYLE_SOLID,
): void {
  let color = Color;
  let w = width;
  let s = style;
  const dots = [1, 3];

  // Under OSX and while printing when wxPen is set to 0, renderer follows the request drawing
  // nothing & in the bitmap world the minimum is enough to light a pixel, in vectorial one not
  if (w <= 1 && DC.GetBrush().GetStyle() !== wxBrushStyle.wxBRUSHSTYLE_SOLID)
    w = DC.DeviceToLogicalXRel(1);

  if (s_ForceBlackPen) color = COLOR4D_BLACK;

  // wxWidgets will enforce a minimum pen width when printing, so we have to make the pen
  // transparent when we don't want the object stroked.
  if (w === 0) {
    color = COLOR4D_UNSPECIFIED;
    s = wxPenStyle.wxPENSTYLE_TRANSPARENT;
  }

  const curr_pen = DC.GetPen();

  if (
    !curr_pen.IsOk() ||
    !colorEq(curr_pen.GetColour(), color) ||
    curr_pen.GetWidth() !== w ||
    curr_pen.GetStyle() !== s
  ) {
    const pen = new wxPen();
    pen.SetColour(color);

    if (s === wxPenStyle.wxPENSTYLE_DOT) {
      s = wxPenStyle.wxPENSTYLE_USER_DASH;
      pen.SetDashes(dots);
    }

    pen.SetWidth(w);
    pen.SetStyle(s);
    DC.SetPen(pen);
  } else {
    // Should be not needed, but on Linux, in printing process
    // the curr pen settings needs to be sometimes re-initialized
    // Clearly, this is due to a bug, related to SetBrush(),
    // but we have to live with it, at least on wxWidgets 3.0
    DC.SetPen(curr_pen);
  }
}

export function GRSetBrush(DC: wxDC, Color: Color4d, fill = false): void {
  let color = Color;

  if (s_ForceBlackPen) color = COLOR4D_BLACK;

  if (!colorEq(s_DC_lastbrushcolor, color) || s_DC_lastbrushfill !== fill || s_DC_lastDC !== DC) {
    const brush = new wxBrush();
    brush.SetColour(color);

    if (fill) brush.SetStyle(wxBrushStyle.wxBRUSHSTYLE_SOLID);
    else brush.SetStyle(wxBrushStyle.wxBRUSHSTYLE_TRANSPARENT);

    DC.SetBrush(brush);

    s_DC_lastbrushcolor = color;
    s_DC_lastbrushfill = fill;
    s_DC_lastDC = DC;
  }
}

/**
 * @param flagforce True to force a black pen whatever the asked color.
 */
export function GRForceBlackPen(flagforce: boolean): void {
  s_ForceBlackPen = flagforce;
}

/**
 * @return True if a black pen was forced or false if not forced.
 */
export function GetGRForceBlackPenState(): boolean {
  return s_ForceBlackPen;
}

export function GRLine(
  DC: wxDC,
  aStart: VECTOR2I,
  aEnd: VECTOR2I,
  aWidth: number,
  aColor: Color4d,
  aStyle: wxPenStyle = wxPenStyle.wxPENSTYLE_SOLID,
): void {
  GRSetColorPen(DC, aColor, aWidth, aStyle);
  winDrawLine(DC, aStart.x, aStart.y, aEnd.x, aEnd.y, aWidth);
  GRLastMoveToX = aEnd.x;
  GRLastMoveToY = aEnd.y;
}

export function GRMoveTo(x: number, y: number): void {
  GRLastMoveToX = x;
  GRLastMoveToY = y;
}

export function GRLineTo(DC: wxDC, x: number, y: number, width: number, Color: Color4d): void {
  GRLine(DC, { x: GRLastMoveToX, y: GRLastMoveToY }, { x, y }, width, Color);
}

/**
 * Draw an outline of a thick segment with rounded ends.
 */
export function GRCSegm(DC: wxDC, A: VECTOR2I, B: VECTOR2I, width: number, Color: Color4d): void {
  GRLastMoveToX = B.x;
  GRLastMoveToY = B.y;

  if (width <= 2) {
    /*  single line or 2 pixels */
    GRSetColorPen(DC, Color, width);
    DC.DrawLine(A.x, A.y, B.x, B.y);
    return;
  }

  GRSetBrush(DC, Color, NOT_FILLED);
  GRSetColorPen(DC, Color, 0);

  const radius = (width + 1) >> 1;
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const angle = EDA_ANGLE.fromVector({ x: dx, y: dy }).negate();
  const org = { x: A.x, y: A.y };
  const len = Math.trunc(Math.hypot(dx, dy));

  // We know if the DC is mirrored, to draw arcs
  const slx = DC.DeviceToLogicalX(1) - DC.DeviceToLogicalX(0);
  const sly = DC.DeviceToLogicalY(1) - DC.DeviceToLogicalY(0);
  const mirrored = (slx > 0 && sly < 0) || (slx < 0 && sly > 0);

  const add = (p: VECTOR2I): VECTOR2I => ({ x: p.x + org.x, y: p.y + org.y });

  // first edge
  let start = add(RotatePoint({ x: 0, y: radius }, angle));
  let end = add(RotatePoint({ x: len, y: radius }, angle));

  DC.DrawLine(start, end);

  // first rounded end
  end = add(RotatePoint({ x: 0, y: -radius }, angle));

  if (!mirrored) DC.DrawArc(end, start, org);
  else DC.DrawArc(start, end, org);

  // second edge
  start = add(RotatePoint({ x: len, y: -radius }, angle));

  DC.DrawLine(start, end);

  // second rounded end
  end = add(RotatePoint({ x: len, y: radius }, angle));

  if (!mirrored) DC.DrawArc(end.x, end.y, start.x, start.y, B.x, B.y);
  else DC.DrawArc(start.x, start.y, end.x, end.y, B.x, B.y);
}

export function GRFilledSegment(
  aDC: wxDC,
  aStart: VECTOR2I,
  aEnd: VECTOR2I,
  aWidth: number,
  aColor: Color4d,
): void {
  GRSetColorPen(aDC, aColor, aWidth);
  winDrawLine(aDC, aStart.x, aStart.y, aEnd.x, aEnd.y, aWidth);
}

/**
 * Draw a new polyline and fill it if Fill, in screen space.
 */
function GRSPoly(
  DC: wxDC,
  n: number,
  Points: readonly VECTOR2I[],
  Fill: boolean,
  width: number,
  Color: Color4d,
  BgColor: Color4d,
): void {
  if (Fill && n > 2) {
    GRSetBrush(DC, BgColor, FILLED);
    GRSetColorPen(DC, Color, width);
    vector2IwxDrawPolygon(DC, Points, n);
  } else {
    GRMoveTo(Points[0]!.x, Points[0]!.y);

    for (let i = 1; i < n; ++i) GRLineTo(DC, Points[i]!.x, Points[i]!.y, width, Color);
  }
}

/**
 * Draw a new closed polyline and fill it if Fill, in screen space.
 */
function GRSClosedPoly(
  aDC: wxDC,
  aPointCount: number,
  aPoints: readonly VECTOR2I[],
  aFill: boolean,
  aWidth: number,
  aColor: Color4d,
  aBgColor: Color4d,
): void {
  if (aFill && aPointCount > 2) {
    GRLastMoveToX = aPoints[aPointCount - 1]!.x;
    GRLastMoveToY = aPoints[aPointCount - 1]!.y;
    GRSetBrush(aDC, aBgColor, FILLED);
    GRSetColorPen(aDC, aColor, aWidth);
    vector2IwxDrawPolygon(aDC, aPoints, aPointCount);
  } else {
    GRMoveTo(aPoints[0]!.x, aPoints[0]!.y);

    for (let i = 1; i < aPointCount; ++i)
      GRLineTo(aDC, aPoints[i]!.x, aPoints[i]!.y, aWidth, aColor);

    const lastpt = aPointCount - 1;

    // Close the polygon
    if (aPoints[lastpt]!.x !== aPoints[0]!.x || aPoints[lastpt]!.y !== aPoints[0]!.y)
      GRLineTo(aDC, aPoints[0]!.x, aPoints[0]!.y, aWidth, aColor);
  }
}

/**
 * Draw a new polyline and fill it if Fill, in drawing space.
 */
export function GRPoly(
  DC: wxDC,
  n: number,
  Points: readonly VECTOR2I[],
  Fill: boolean,
  width: number,
  Color: Color4d,
  BgColor: Color4d,
): void {
  GRSPoly(DC, n, Points, Fill, width, Color, BgColor);
}

/**
 * Draw a closed polygon onto the drawing context \a aDC and optionally fills and/or draws
 * a border around it.
 */
export function GRClosedPoly(
  DC: wxDC,
  n: number,
  Points: readonly VECTOR2I[],
  Fill: boolean,
  Color: Color4d,
): void {
  GRSClosedPoly(DC, n, Points, Fill, 0, Color, Color);
}

export function GRCircle(
  aDC: wxDC,
  aPos: VECTOR2I,
  aRadius: number,
  aWidth: number,
  aColor: Color4d,
): void {
  GRSetBrush(aDC, aColor, NOT_FILLED);
  GRSetColorPen(aDC, aColor, aWidth);

  // Draw two arcs here to make a circle.  Unfortunately, the printerDC doesn't handle
  // transparent brushes when used with circles.  It does work for for arcs, however
  aDC.DrawArc(aPos.x + aRadius, aPos.y, aPos.x - aRadius, aPos.y, aPos.x, aPos.y);
  aDC.DrawArc(aPos.x - aRadius, aPos.y, aPos.x + aRadius, aPos.y, aPos.x, aPos.y);
}

export function GRFilledCircle(
  aDC: wxDC,
  aPos: VECTOR2I,
  aRadius: number,
  aWidth: number,
  aStrokeColor: Color4d,
  aFillColor: Color4d,
): void {
  GRSetBrush(aDC, aFillColor, FILLED);
  GRSetColorPen(aDC, aStrokeColor, aWidth);
  aDC.DrawEllipse(aPos.x - aRadius, aPos.y - aRadius, 2 * aRadius, 2 * aRadius);
}

export function GRArc(
  aDC: wxDC,
  aStart: VECTOR2I,
  aEnd: VECTOR2I,
  aCenter: VECTOR2I,
  aWidth: number,
  aColor: Color4d,
): void {
  GRSetBrush(aDC, aColor);
  GRSetColorPen(aDC, aColor, aWidth);
  aDC.DrawArc(aStart.x, aStart.y, aEnd.x, aEnd.y, aCenter.x, aCenter.y);
}

export function GRFilledArc(
  DC: wxDC,
  aStart: VECTOR2I,
  aEnd: VECTOR2I,
  aCenter: VECTOR2I,
  width: number,
  Color: Color4d,
  BgColor: Color4d,
): void {
  GRSetBrush(DC, BgColor, FILLED);
  GRSetColorPen(DC, Color, width);
  DC.DrawArc(aStart.x, aStart.y, aEnd.x, aEnd.y, aCenter.x, aCenter.y);
}

export function GRRect(
  DC: wxDC,
  aStart: VECTOR2I,
  aEnd: VECTOR2I,
  aWidth: number,
  aColor: Color4d,
): void {
  GRSRect(DC, aStart.x, aStart.y, aEnd.x, aEnd.y, aWidth, aColor);
}

export function GRFilledRect(
  DC: wxDC,
  aStart: VECTOR2I,
  aEnd: VECTOR2I,
  aWidth: number,
  aColor: Color4d,
  aBgColor: Color4d,
): void {
  GRSFilledRect(DC, aStart.x, aStart.y, aEnd.x, aEnd.y, aWidth, aColor, aBgColor);
}

function GRSRect(
  aDC: wxDC,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  aWidth: number,
  aColor: Color4d,
): void {
  const points: VECTOR2I[] = [
    { x: x1, y: y1 },
    { x: x1, y: y2 },
    { x: x2, y: y2 },
    { x: x2, y: y1 },
  ];
  points.push(points[0]!);
  GRSClosedPoly(aDC, 5, points, NOT_FILLED, aWidth, aColor, aColor);
}

function GRSFilledRect(
  aDC: wxDC,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  aWidth: number,
  _aColor: Color4d,
  aBgColor: Color4d,
): void {
  const points: VECTOR2I[] = [
    { x: x1, y: y1 },
    { x: x1, y: y2 },
    { x: x2, y: y2 },
    { x: x2, y: y1 },
  ];
  points.push(points[0]!);

  GRSetBrush(aDC, aBgColor, FILLED);
  GRSetColorPen(aDC, aBgColor, aWidth);
  vector2IwxDrawPolygon(aDC, points, 5);
}
