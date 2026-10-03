// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A GAL that draws nothing and records every primitive with the pen state it was drawn
 * with, for the SCH_PAINTER tests: each expectation is read off sch_painter.cpp.
 */
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import type { GLYPH_LIKE } from '@ziroeda/common/font/glyph.js';
import type { Vec2, VECTOR2I } from '@ziroeda/kimath';
import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import type { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';

export interface PEN {
  fill: boolean;
  stroke: boolean;
  width: number;
  strokeColor: Color4d;
  fillColor: Color4d;
}

export type CALL =
  | ({ op: 'line'; a: Vec2; b: Vec2 } & PEN)
  | ({ op: 'circle'; c: Vec2; r: number } & PEN)
  | ({ op: 'rect'; a: Vec2; b: Vec2 } & PEN)
  | ({ op: 'arc'; c: Vec2; r: number; start: number; angle: number } & PEN)
  | ({ op: 'polygon'; points: Vec2[] } & PEN)
  | ({ op: 'polyline'; points: Vec2[] } & PEN)
  | ({ op: 'glyph' } & PEN)
  | ({ op: 'bitmap'; text: string; at: Vec2 } & PEN)
  | ({ op: 'curve'; a: Vec2; c1: Vec2; c2: Vec2; b: Vec2 } & PEN)
  | { op: 'save' }
  | { op: 'restore' }
  | { op: 'translate'; t: Vec2 };

export class RECORDING_GAL extends GAL {
  calls: CALL[] = [];
  private pen: PEN = {
    fill: false,
    stroke: true,
    width: 0,
    strokeColor: { r: 0, g: 0, b: 0, a: 0 },
    fillColor: { r: 0, g: 0, b: 0, a: 0 },
  };

  constructor() {
    super(new GAL_DISPLAY_OPTIONS());
    this.ResizeScreen(1000, 1000);
  }

  override ResizeScreen(aWidth: number, aHeight: number): void {
    this.m_screenSize = { x: aWidth, y: aHeight };
    this.ComputeWorldScreenMatrix();
  }

  /** Every recorded primitive (no state changes). */
  get draws(): Exclude<CALL, { op: 'save' | 'restore' | 'translate' }>[] {
    return this.calls.filter(
      (c): c is Exclude<CALL, { op: 'save' | 'restore' | 'translate' }> =>
        c.op !== 'save' && c.op !== 'restore' && c.op !== 'translate',
    );
  }

  override SetIsFill(aIsFillEnabled: boolean): void {
    this.pen = { ...this.pen, fill: aIsFillEnabled };
    super.SetIsFill(aIsFillEnabled);
  }
  override SetIsStroke(aIsStrokeEnabled: boolean): void {
    this.pen = { ...this.pen, stroke: aIsStrokeEnabled };
    super.SetIsStroke(aIsStrokeEnabled);
  }
  override SetLineWidth(aLineWidth: number): void {
    this.pen = { ...this.pen, width: aLineWidth };
    super.SetLineWidth(aLineWidth);
  }
  override SetStrokeColor(aColor: Color4d): void {
    this.pen = { ...this.pen, strokeColor: aColor };
    super.SetStrokeColor(aColor);
  }
  override SetFillColor(aColor: Color4d): void {
    this.pen = { ...this.pen, fillColor: aColor };
    super.SetFillColor(aColor);
  }

  override DrawLine(aStartPoint: Vec2, aEndPoint: Vec2): void {
    this.calls.push({ op: 'line', a: { ...aStartPoint }, b: { ...aEndPoint }, ...this.pen });
  }
  override DrawCircle(aCenterPoint: Vec2, aRadius: number): void {
    this.calls.push({ op: 'circle', c: { ...aCenterPoint }, r: aRadius, ...this.pen });
  }
  override DrawRectangle(aStartPoint: Vec2, aEndPoint: Vec2): void {
    this.calls.push({ op: 'rect', a: { ...aStartPoint }, b: { ...aEndPoint }, ...this.pen });
  }
  override DrawArc(
    aCenterPoint: Vec2,
    aRadius: number,
    aStartAngle: EDA_ANGLE,
    aAngle: EDA_ANGLE,
  ): void {
    this.calls.push({
      op: 'arc',
      c: { ...aCenterPoint },
      r: aRadius,
      start: aStartAngle.AsDegrees(),
      angle: aAngle.AsDegrees(),
      ...this.pen,
    });
  }
  override DrawPolygon(a: readonly Vec2[] | SHAPE_LINE_CHAIN | SHAPE_POLY_SET): void {
    let points: Vec2[];

    if (Array.isArray(a)) points = a.map((p) => ({ ...p }));
    else if (a instanceof SHAPE_LINE_CHAIN) points = a.CPoints().map((p) => ({ ...p }));
    else {
      const set = a as SHAPE_POLY_SET;
      points = [];
      for (let i = 0; i < set.OutlineCount(); i++)
        points.push(
          ...set
            .COutline(i)
            .CPoints()
            .map((p) => ({ ...p })),
        );
    }

    this.calls.push({ op: 'polygon', points, ...this.pen });
  }
  override DrawPolyline(a: readonly Vec2[] | SHAPE_LINE_CHAIN): void {
    const points = Array.isArray(a)
      ? a.map((p) => ({ ...p }))
      : (a as SHAPE_LINE_CHAIN).CPoints().map((p) => ({ ...p }));
    this.calls.push({ op: 'polyline', points, ...this.pen });
  }
  override DrawGlyph(_aGlyph: GLYPH_LIKE, _aNth = 0, _aTotal = 1): void {
    this.calls.push({ op: 'glyph', ...this.pen });
  }
  override BitmapText(aText: string, aPosition: VECTOR2I, _aAngle: EDA_ANGLE): void {
    this.calls.push({ op: 'bitmap', text: aText, at: { ...aPosition }, ...this.pen });
  }
  override DrawCurve(aStart: Vec2, aC1: Vec2, aC2: Vec2, aEnd: Vec2): void {
    this.calls.push({
      op: 'curve',
      a: { ...aStart },
      c1: { ...aC1 },
      c2: { ...aC2 },
      b: { ...aEnd },
      ...this.pen,
    });
  }
  override Save(): void {
    this.calls.push({ op: 'save' });
  }
  override Restore(): void {
    this.calls.push({ op: 'restore' });
  }
  override Translate(aTranslation: Vec2): void {
    this.calls.push({ op: 'translate', t: { ...aTranslation } });
  }
}
