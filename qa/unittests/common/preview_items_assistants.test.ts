// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The preview assistants as VIEW items drawn through the GAL:
 * `KIGFX::PREVIEW::DRAW_CONTEXT` (draw_context.cpp), `TWO_POINT_ASSISTANT`
 * (two_point_assistant.cpp) and `ARC_ASSISTANT` (arc_assistant.cpp), the
 * items DRAWING_TOOL puts on the overlay. Each expectation cites its line.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { FONT } from '@ziroeda/common/font/font.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import { GAL_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { ARC_ASSISTANT } from '@ziroeda/common/preview_items/arc_assistant.js';
import { ARC_GEOM_MANAGER, ARC_STEPS } from '@ziroeda/common/preview_items/arc_geom_manager.js';
import { DRAW_CONTEXT } from '@ziroeda/common/preview_items/draw_context.js';
import {
  GEOM_SHAPE,
  TWO_POINT_ASSISTANT,
} from '@ziroeda/common/preview_items/two_point_assistant.js';
import { TWO_POINT_GEOMETRY_MANAGER } from '@ziroeda/common/preview_items/two_point_geom_manager.js';
import type { VIEW } from '@ziroeda/common/view/view.js';
import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);
const AUX: Color4d = { r: 1, g: 1, b: 1, a: 1 };

class RECORDING_GAL extends GAL {
  lines: { a: Vec2; b: Vec2; color: Color4d }[] = [];
  circles: { c: Vec2; r: number; color: Color4d }[] = [];
  arcs: { start: number; sweep: number }[] = [];

  constructor() {
    super(new GAL_DISPLAY_OPTIONS());
  }

  override DrawLine(aStart: Vec2, aEnd: Vec2): void {
    this.lines.push({ a: aStart, b: aEnd, color: this.GetStrokeColor() });
  }

  override DrawCircle(aCenter: Vec2, aRadius: number): void {
    this.circles.push({ c: aCenter, r: aRadius, color: this.GetStrokeColor() });
  }

  override DrawArc(_aCenter: Vec2, _aRadius: number, aStart: EDA_ANGLE, aAngle: EDA_ANGLE): void {
    this.arcs.push({ start: aStart.AsDegrees(), sweep: aAngle.AsDegrees() });
  }
}

let gal: RECORDING_GAL;
let view: VIEW;
let dark = true;
let texts: string[];

beforeEach(() => {
  gal = new RECORDING_GAL();
  (gal as unknown as { m_worldScale: number }).m_worldScale = 1e-5;
  dark = true;
  const settings = {
    GetLayerColor: (l: number) =>
      l === GAL_LAYER_ID.LAYER_AUX_ITEMS ? AUX : { r: 0, g: 0, b: 0, a: 1 },
    IsBackgroundDark: () => dark,
  };
  view = {
    GetGAL: () => gal,
    GetPainter: () => ({ GetSettings: () => settings }),
  } as unknown as VIEW;
  texts = [];
  // DrawTextNextToCursor's only use of the font is `font->Draw( gal, str, ... )`.
  vi.spyOn(FONT, 'GetFont').mockReturnValue({
    Draw: (_g: unknown, aText: string) => {
      texts.push(aText);
    },
  } as unknown as FONT);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DRAW_CONTEXT (draw_context.cpp)', () => {
  it('draws in the aux-items colour, de-emphasised at half alpha (:42-46, :58-67)', () => {
    const ctx = new DRAW_CONTEXT(view);
    ctx.DrawLine({ x: 0, y: 0 }, { x: 10, y: 0 }, true);
    expect(gal.lines[0]!.color).toEqual({ ...AUX, a: 0.5 });
    ctx.DrawCircle({ x: 0, y: 0 }, 5, false);
    expect(gal.circles[0]!.color).toEqual({ ...AUX, a: 1 });
  });

  it('a multiple of 45 degrees is green: light green on dark, darker on light (:122-139)', () => {
    const ctx = new DRAW_CONTEXT(view);
    ctx.DrawLineWithAngleHighlight({ x: 0, y: 0 }, { x: 10, y: 10 }, false);
    expect(gal.lines[0]!.color).toEqual({ r: 0.5, g: 1, b: 0.5, a: 1 });
    dark = false;
    ctx.DrawLineWithAngleHighlight({ x: 0, y: 0 }, { x: 0, y: 10 }, false);
    expect(gal.lines[1]!.color).toEqual({ r: 0, g: 0.7, b: 0, a: 1 });
    ctx.DrawLineWithAngleHighlight({ x: 0, y: 0 }, { x: 10, y: 3 }, false);
    expect(gal.lines[2]!.color).toEqual(AUX);
  });

  it('a dashed line is dashes of aDashFill every aDashStep (:91-104)', () => {
    new DRAW_CONTEXT(view).DrawLineDashed({ x: 0, y: 0 }, { x: 100, y: 0 }, 30, 10, false);
    expect(gal.lines.map((l) => [l.a.x, l.b.x])).toEqual([
      [0, 10],
      [30, 40],
      [60, 70],
      [90, 100],
    ]);
  });

  it('a dashed circle is an arc per step (:70-84)', () => {
    new DRAW_CONTEXT(view).DrawCircleDashed({ x: 0, y: 0 }, 5, 90, 30, false);
    expect(gal.arcs).toEqual([
      { start: 0, sweep: 30 },
      { start: 90, sweep: 120 },
      { start: 180, sweep: 210 },
      { start: 270, sweep: 300 },
    ]);
  });
});

describe('TWO_POINT_ASSISTANT (two_point_assistant.cpp)', () => {
  const mgr = (end: Vec2): TWO_POINT_GEOMETRY_MANAGER => {
    const m = new TWO_POINT_GEOMETRY_MANAGER();
    m.SetOrigin({ x: 0, y: 0 });
    m.SetEnd(end);
    return m;
  };

  it('a segment reads its length and an angle with up positive (:72-79)', () => {
    new TWO_POINT_ASSISTANT(
      mgr({ x: 0, y: -MM(2) }),
      pcbIUScale,
      'mm',
      GEOM_SHAPE.SEGMENT,
    ).ViewDraw(GAL_LAYER_ID.LAYER_SELECT_OVERLAY, view);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toMatch(/^l: 2(\.0+)? mm$/);
    expect(texts[1]).toMatch(/^θ: 90/);
  });

  it('a rectangle reads x and y (:80-84)', () => {
    new TWO_POINT_ASSISTANT(
      mgr({ x: -MM(3), y: MM(1) }),
      pcbIUScale,
      'mm',
      GEOM_SHAPE.RECT,
    ).ViewDraw(GAL_LAYER_ID.LAYER_SELECT_OVERLAY, view);
    expect(texts[0]).toMatch(/^x: 3/);
    expect(texts[1]).toMatch(/^y: 1/);
  });

  it('a circle draws its radius line and reads r (:85-92)', () => {
    new TWO_POINT_ASSISTANT(mgr({ x: MM(4), y: 0 }), pcbIUScale, 'mm', GEOM_SHAPE.CIRCLE).ViewDraw(
      GAL_LAYER_ID.LAYER_SELECT_OVERLAY,
      view,
    );
    expect(gal.lines).toHaveLength(1);
    expect(texts).toEqual([expect.stringMatching(/^r: 4/)]);
  });

  it('draws nothing reset, and nothing at zero length (:60-70)', () => {
    new TWO_POINT_ASSISTANT(
      new TWO_POINT_GEOMETRY_MANAGER(),
      pcbIUScale,
      'mm',
      GEOM_SHAPE.SEGMENT,
    ).ViewDraw(GAL_LAYER_ID.LAYER_SELECT_OVERLAY, view);
    new TWO_POINT_ASSISTANT(mgr({ x: 0, y: 0 }), pcbIUScale, 'mm', GEOM_SHAPE.SEGMENT).ViewDraw(
      GAL_LAYER_ID.LAYER_SELECT_OVERLAY,
      view,
    );
    expect(texts).toEqual([]);
  });

  it('is on the select overlay and the drop-shadow overlay; unbounded while drawing (:44-56)', () => {
    const a = new TWO_POINT_ASSISTANT(mgr({ x: 5, y: 0 }), pcbIUScale, 'mm', GEOM_SHAPE.SEGMENT);
    expect(a.ViewGetLayers()).toEqual([
      GAL_LAYER_ID.LAYER_SELECT_OVERLAY,
      GAL_LAYER_ID.LAYER_GP_OVERLAY,
    ]);
    expect(a.ViewBBox().GetWidth()).toBeGreaterThan(1e9);
    const reset = new TWO_POINT_ASSISTANT(
      new TWO_POINT_GEOMETRY_MANAGER(),
      pcbIUScale,
      'mm',
      GEOM_SHAPE.SEGMENT,
    );
    expect(reset.ViewBBox().GetWidth()).toBe(0);
  });
});

describe('ARC_ASSISTANT (arc_assistant.cpp)', () => {
  it('placing the start: the radius at full strength, the guide circle dimmed, r and theta (:76-99)', () => {
    const m = new ARC_GEOM_MANAGER();
    m.AddPoint({ x: 0, y: 0 }, true);
    m.AddPoint({ x: MM(5), y: 0 }, false);
    expect(m.GetStep()).toBe(ARC_STEPS.SET_START);
    new ARC_ASSISTANT(m, pcbIUScale, 'mm').ViewDraw(GAL_LAYER_ID.LAYER_SELECT_OVERLAY, view);
    expect(gal.lines[0]!.color.a).toBe(1);
    expect(gal.circles[0]!.r).toBe(MM(5));
    expect(gal.circles[0]!.color.a).toBe(0.5);
    expect(texts[0]).toMatch(/^r: 5/);
    expect(texts[1]).toMatch(/^θ: 0/);
  });

  it('sweeping: the first radius dims, the end radius and a dimmed extender, delta-theta and theta (:81-118)', () => {
    const m = new ARC_GEOM_MANAGER();
    m.AddPoint({ x: 0, y: 0 }, true);
    m.AddPoint({ x: MM(5), y: 0 }, true);
    m.AddPoint({ x: 0, y: MM(5) }, false);
    expect(m.GetStep()).toBe(ARC_STEPS.SET_ANGLE);
    new ARC_ASSISTANT(m, pcbIUScale, 'mm').ViewDraw(GAL_LAYER_ID.LAYER_SELECT_OVERLAY, view);
    expect(gal.lines.map((l) => l.color.a)).toEqual([0.5, 1, 0.5]);
    expect(gal.circles).toHaveLength(0);
    expect(texts[0]).toMatch(/^Δθ: /);
    expect(texts[1]).toMatch(/^θ: /);
  });
});
