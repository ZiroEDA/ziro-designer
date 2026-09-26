// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `CAIRO_GAL_BASE` / `CAIRO_GAL` (common/gal/cairo/cairo_gal.cpp), drawn on a
 * recording canvas.
 *
 * Each expectation is the geometry of the C++'s Cairo calls, worked by hand
 * from the lines cited, then read as the canvas paints `cairo_api.ts` makes of
 * them (a path in device pixels, painted with the state at `cairo_stroke` /
 * `cairo_fill`). The world is set up so the arithmetic stays visible: a
 * 200 x 100 screen, 100 DPI, 0.01 inch per unit and zoom 2, so the world
 * scale is 2 and world (x, y) lands on screen (100 + 2x, 50 + 2y)
 * (graphics_abstraction_layer.cpp:ComputeWorldScreenMatrix).
 */

import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EDA_DRAW_PANEL_GAL, GAL_TYPE } from '@ziroeda/common/draw_panel_gal.js';
import {
  cairo_create,
  cairo_format_t,
  cairo_get_line_width,
  cairo_get_matrix,
  cairo_image_surface_create_for_data,
  cairo_line_to,
  cairo_matrix_new,
  cairo_move_to,
  cairo_scale,
  type cairo_t,
} from '@ziroeda/common/gal/cairo/cairo_api.js';
import {
  CAIRO_GAL,
  CAIRO_GAL_BASE,
  type CAIRO_GAL_WINDOW,
} from '@ziroeda/common/gal/cairo/cairo_gal.js';
import { RENDER_TARGET } from '@ziroeda/common/gal/definitions.js';
import { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import type { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import {
  calls,
  type FakeCanvas,
  fakeCanvas,
  installSurfaceFactory,
  paints,
  r9,
} from './cairo_test_canvas.js';

const PI = Math.PI;
const RED = { r: 1, g: 0, b: 0, a: 1 };
const GREEN = { r: 0, g: 1, b: 0, a: 1 };
const BLUE = { r: 0, g: 0, b: 1, a: 1 };

/** CAIRO_GAL_BASE on one recording canvas, the way CAIRO_PRINT_GAL holds its context. */
class TEST_GAL extends CAIRO_GAL_BASE {
  readonly canvas: FakeCanvas;

  constructor() {
    super(new GAL_DISPLAY_OPTIONS());
    this.canvas = fakeCanvas('screen');
    this.m_surface = cairo_image_surface_create_for_data(
      this.canvas,
      cairo_format_t.CAIRO_FORMAT_ARGB32,
      200,
      100,
      800,
    );
    this.m_context = this.m_currentContext = cairo_create(this.m_surface);
    this.ResizeScreen(200, 100);
    this.SetScreenDPI(100);
    this.SetWorldUnitLength(0.01);
    this.SetZoomFactor(2);
  }

  context(): cairo_t {
    return this.m_currentContext!;
  }

  /** Start a frame and forget what setting it up drew. */
  frame(): this {
    this.BeginDrawing();
    this.canvas.log.length = 0;
    return this;
  }

  /** A path left in the context, as a primitive that does not flush would leave one. */
  leavePath(): void {
    cairo_move_to(this.context(), 1, 1);
    cairo_line_to(this.context(), 5, 1);
    cairo_line_to(this.context(), 5, 5);
    this.m_isElementAdded = true;
  }
}

function strokeGal(): TEST_GAL {
  const gal = new TEST_GAL().frame();
  gal.SetIsFill(false);
  gal.SetIsStroke(true);
  gal.SetStrokeColor(RED);
  return gal;
}

describe('CAIRO_GAL_BASE: the world to screen transform', () => {
  it('is the GAL matrix, copied into Cairo at BeginDrawing (cairo_gal.cpp:1036-1041)', () => {
    const gal = strokeGal();
    expect(gal.GetWorldScale()).toBe(2);
    gal.SetLineWidth(0.25);
    gal.DrawLine({ x: 0, y: 0 }, { x: 10, y: 5 });
    expect(paints(gal.canvas.log)[0]!.path).toEqual([
      ['M', 100.5, 50.5],
      ['L', 120.5, 60.5],
    ]);
  });

  it('mirrors x under a flip', () => {
    const gal = new TEST_GAL();
    gal.SetFlip(true, false);
    gal.frame();
    gal.SetLineWidth(0.25);
    gal.DrawLine({ x: 10, y: 0 }, { x: 10, y: 10 });
    // world x = 10 lands at 100 - 20 = 80
    expect(paints(gal.canvas.log)[0]!.path).toEqual([
      ['M', 80.5, 50.5],
      ['L', 80.5, 70.5],
    ]);
  });

  it('turns under a rotation', () => {
    const gal = new TEST_GAL();
    gal.SetRotation(PI / 2);
    gal.frame();
    gal.SetLineWidth(0.25);
    gal.DrawLine({ x: 0, y: 0 }, { x: 10, y: 0 });
    // (20, 0) turned a quarter: (0, 20), then + (100, 50)
    expect(paints(gal.canvas.log)[0]!.path).toEqual([
      ['M', 100.5, 50.5],
      ['L', 100.5, 70.5],
    ]);
  });

  it('flips arc angles to pi - a and back through the flipped matrix (cairo_gal.cpp:130-175)', () => {
    const gal = new TEST_GAL();
    gal.SetFlip(true, false);
    gal.frame();
    gal.SetIsStroke(true);
    gal.SetIsFill(false);
    gal.DrawArc({ x: 0, y: 0 }, 5, new EDA_ANGLE(0), new EDA_ANGLE(90));
    // flipped: pi - 0 = pi, pi - pi/2 = pi/2, normalised to (pi/2, pi); the flipped
    // matrix's world_rotation is -atan2( 0, -2 ) = -pi, and flipped again 2pi
    const s = (PI / 2 + 2 * PI) % (2 * PI);
    const e = (PI + 2 * PI) % (2 * PI);
    const [p] = paints(gal.canvas.log);
    expect(p!.path).toEqual([
      ['M', r9(100.5 + 10 * Math.cos(s)), r9(50.5 + 10 * Math.sin(s))],
      ['A', 100.5, 50.5, 10, r9(s), r9(e), false],
    ]);
  });
});

describe('CAIRO_GAL_BASE: the pen (syncLineWidth, cairo_gal.cpp:215-236)', () => {
  it('an odd width strokes with round ends, through pixel centres', () => {
    const gal = strokeGal();
    gal.SetLineWidth(1.5); // 3 px
    gal.DrawLine({ x: 0, y: 0 }, { x: 10, y: 5 });
    expect(paints(gal.canvas.log)).toEqual([
      {
        kind: 'stroke',
        path: [
          ['M', 100.5, 50.5],
          ['L', 120.5, 60.5],
        ],
        style: 'rgba(255, 0, 0, 1)',
        op: 'source-over',
        alpha: 1,
        lineWidth: 3,
        cap: 'round',
        join: 'round',
      },
    ]);
  });

  it('an even width strokes through pixel corners', () => {
    const gal = strokeGal();
    gal.SetLineWidth(1); // 2 px
    gal.DrawLine({ x: 0.3, y: 0.3 }, { x: 10, y: 0.3 });
    const [p] = paints(gal.canvas.log);
    expect([p!.path, p!.lineWidth]).toEqual([
      [
        ['M', 101, 51],
        ['L', 120, 51],
      ],
      2,
    ]);
  });

  it('one pixel or less is one pixel, butt-ended and mitred', () => {
    const gal = strokeGal();
    gal.SetLineWidth(0.25); // 0.5 px
    gal.DrawLine({ x: 0, y: 0 }, { x: 10, y: 0 });
    const [p] = paints(gal.canvas.log);
    expect([p!.lineWidth, p!.cap, p!.join]).toEqual([1, 'butt', 'miter']);
  });

  it('is in world units, rounded to whole pixels at the zoom', () => {
    const at = (aZoom: number) => {
      const gal = new TEST_GAL();
      gal.SetZoomFactor(aZoom);
      gal.frame();
      gal.SetLineWidth(1.7);
      gal.DrawLine({ x: 0, y: 0 }, { x: 10, y: 0 });
      const [p] = paints(gal.canvas.log);
      return [p!.lineWidth, p!.cap];
    };
    // floor( 1.7 * 3 + 0.5 ) = 5; floor( 1.7 * 0.5 + 0.5 ) = 1
    expect(at(3)).toEqual([5, 'round']);
    expect(at(0.5)).toEqual([1, 'butt']);
  });
});

describe('CAIRO_GAL_BASE: primitives', () => {
  it('DrawSegment with fill on strokes the centreline in the fill colour (cairo_gal.cpp:261-273)', () => {
    const gal = new TEST_GAL().frame();
    gal.SetIsFill(true);
    gal.SetIsStroke(false);
    gal.SetFillColor(GREEN);
    gal.DrawSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, 4);
    expect(paints(gal.canvas.log)).toEqual([
      {
        kind: 'stroke',
        path: [
          ['M', 100, 50],
          ['L', 120, 50],
        ],
        style: 'rgba(0, 255, 0, 1)',
        op: 'source-over',
        alpha: 1,
        lineWidth: 8,
        cap: 'round',
        join: 'round',
      },
    ]);
  });

  it('DrawSegment with fill off draws the outline: two sides, two rounded ends (cairo_gal.cpp:274-320)', () => {
    const gal = strokeGal();
    gal.DrawSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, 4);
    const [sides, ends] = paints(gal.canvas.log);
    expect(sides!.path).toEqual([
      ['M', 100, 54],
      ['L', 120, 54],
      ['M', 100, 46],
      ['L', 120, 46],
    ]);
    // SetLineWidth( 1.0 ): 2 px
    expect(sides!.lineWidth).toBe(2);
    expect(ends!.path).toEqual([
      ['M', 120, 46],
      ['A', 120, 50, 4, r9(-PI / 2), r9(PI / 2), false],
      ['A', 100, 50, 4, r9(PI / 2), r9((3 * PI) / 2), false],
    ]);
  });

  it('DrawPolyline is one open path; one point draws nothing (cairo_gal.cpp:1239-1262)', () => {
    const gal = strokeGal();
    gal.DrawPolyline([{ x: 5, y: 5 }]);
    gal.DrawPolyline([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    const all = paints(gal.canvas.log);
    expect(all.length).toBe(1);
    expect(all[0]!.path).toEqual([
      ['M', 100.5, 50.5],
      ['L', 120.5, 50.5],
      ['L', 120.5, 70.5],
    ]);
  });

  it('a closed SHAPE_LINE_CHAIN goes back to its first point (cairo_gal.cpp:1316-1341)', () => {
    const gal = strokeGal();
    const chain = new SHAPE_LINE_CHAIN(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      true,
    );
    gal.DrawPolyline(chain);
    expect(paints(gal.canvas.log)[0]!.path).toEqual([
      ['M', 100.5, 50.5],
      ['L', 120.5, 50.5],
      ['L', 120.5, 70.5],
      ['L', 100.5, 50.5],
    ]);
  });

  it('DrawPolygon fills without a stroke; with one, fills then strokes the same path (cairo_gal.cpp:1127-1152)', () => {
    const gal = new TEST_GAL().frame();
    gal.SetIsFill(true);
    gal.SetIsStroke(false);
    gal.SetFillColor({ r: 0, g: 0, b: 1, a: 0.5 });
    const tri = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    const path = [
      ['M', 100.5, 50.5],
      ['L', 120.5, 50.5],
      ['L', 120.5, 70.5],
    ];
    gal.DrawPolygon(tri);
    gal.SetIsStroke(true);
    gal.SetStrokeColor(RED);
    gal.DrawPolygon(tri);
    expect(paints(gal.canvas.log).map((p) => [p.kind, p.path, p.style])).toEqual([
      ['fill', path, `rgba(0, 0, 255, ${128 / 255})`],
      ['fill', path, `rgba(0, 0, 255, ${128 / 255})`],
      ['stroke', path, 'rgba(255, 0, 0, 1)'],
    ]);
  });

  it('DrawPolygon of a SHAPE_POLY_SET fills each outline, holes not drawn (cairo_gal.cpp:474-478)', () => {
    const gal = new TEST_GAL().frame();
    gal.SetIsFill(true);
    gal.SetIsStroke(false);
    const set = new SHAPE_POLY_SET();
    const square = (x: number) =>
      new SHAPE_LINE_CHAIN(
        [
          { x, y: 0 },
          { x: x + 4, y: 0 },
          { x: x + 4, y: 4 },
        ],
        true,
      );
    set.AddOutline(square(0));
    set.AddHole(square(1));
    set.AddOutline(square(20));
    gal.DrawPolygon(set);
    expect(paints(gal.canvas.log).map((p) => p.path[0])).toEqual([
      ['M', 100.5, 50.5],
      ['M', 140.5, 50.5],
    ]);
  });

  it('DrawCircle snaps centre and radius to pixel centres; flushPath sets the full pen back (cairo_gal.cpp:332-345)', () => {
    const gal = strokeGal();
    gal.SetLineWidth(5); // 10 px, over the min( 2r, w ) = 5 of :339
    gal.DrawCircle({ x: 5, y: 5 }, 1);
    const [p] = paints(gal.canvas.log);
    // c = (110, 60): an even pen -> (110, 60); r = floor( 2 + 0.5 ) + 0.5 = 2.5
    expect(p!.path).toEqual([['M', 112.5, 60], ['A', 110, 60, 2.5, 0, r9(2 * PI), false], ['Z']]);
    expect(p!.lineWidth).toBe(10);
  });

  it('DrawArc strokes the arc about the rounded centre (cairo_gal.cpp:348-389)', () => {
    const gal = strokeGal();
    gal.DrawArc({ x: 0, y: 0 }, 5, new EDA_ANGLE(0), new EDA_ANGLE(90));
    expect(paints(gal.canvas.log)[0]!.path).toEqual([
      ['M', 110.5, 50.5],
      ['A', 100.5, 50.5, 10, 0, r9(PI / 2), false],
    ]);
  });

  it('DrawArc with a negative angle draws the same arc: the angles are normalised', () => {
    const forward = strokeGal();
    forward.DrawArc({ x: 0, y: 0 }, 5, new EDA_ANGLE(0), new EDA_ANGLE(90));
    const backward = strokeGal();
    backward.DrawArc({ x: 0, y: 0 }, 5, new EDA_ANGLE(90), new EDA_ANGLE(-90));
    expect(paints(backward.canvas.log)).toEqual(paints(forward.canvas.log));
  });

  it('DrawArc with fill on is a pie: centre, arc, close', () => {
    const gal = new TEST_GAL().frame();
    gal.SetIsFill(true);
    gal.SetIsStroke(false);
    gal.DrawArc({ x: 0, y: 0 }, 5, new EDA_ANGLE(0), new EDA_ANGLE(90));
    const [p] = paints(gal.canvas.log);
    expect([p!.kind, p!.path]).toEqual([
      'fill',
      [['M', 100.5, 50.5], ['A', 100.5, 50.5, 10, 0, r9(PI / 2), false], ['Z']],
    ]);
  });

  it('DrawArcSegment with fill off outlines the band: two arcs and two end caps, the first backwards (cairo_gal.cpp:408-449)', () => {
    const gal = strokeGal();
    gal.DrawArcSegment({ x: 0, y: 0 }, 5, new EDA_ANGLE(0), new EDA_ANGLE(90), 2, 0);
    const [p] = paints(gal.canvas.log);
    expect(p!.path).toEqual([
      ['M', 108, 50],
      ['A', 100, 50, 8, 0, r9(PI / 2), false],
      ['M', 112, 50],
      ['A', 100, 50, 12, 0, r9(PI / 2), false],
      // cairo_arc_negative( 0 .. pi ): pi lowered a turn, to -pi
      ['M', 112, 50],
      ['A', 110, 50, 2, 0, r9(-PI), true],
      ['M', 100, 62],
      ['A', 100, 60, 2, r9(PI / 2), r9((3 * PI) / 2), false],
    ]);
    expect(p!.lineWidth).toBe(1);
  });

  it('DrawArcSegment with fill on strokes the arc at the segment width, then restores fill (cairo_gal.cpp:397-406)', () => {
    const gal = new TEST_GAL().frame();
    gal.SetIsFill(true);
    gal.SetIsStroke(false);
    gal.SetStrokeColor(BLUE);
    gal.DrawArcSegment({ x: 0, y: 0 }, 5, new EDA_ANGLE(0), new EDA_ANGLE(90), 2, 0);
    const [p] = paints(gal.canvas.log);
    expect([p!.kind, p!.lineWidth, p!.cap, p!.path]).toEqual([
      'stroke',
      4,
      'round',
      [
        ['M', 110, 50],
        ['A', 100, 50, 10, 0, r9(PI / 2), false],
      ],
    ]);
    expect([gal.GetIsFill(), gal.GetIsStroke()]).toEqual([true, false]);
  });

  it('DrawRectangle is four sides and a close (cairo_gal.cpp:452-471)', () => {
    const gal = strokeGal();
    gal.DrawRectangle({ x: 0, y: 0 }, { x: 10, y: 5 });
    expect(paints(gal.canvas.log)[0]!.path).toEqual([
      ['M', 100.5, 50.5],
      ['L', 120.5, 50.5],
      ['L', 120.5, 60.5],
      ['L', 100.5, 60.5],
      ['Z'],
    ]);
  });

  it('DrawCurve is the Bezier and a line to its end (cairo_gal.cpp:487-506)', () => {
    const gal = strokeGal();
    gal.DrawCurve({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 5 });
    expect(paints(gal.canvas.log)[0]!.path).toEqual([
      ['M', 100.5, 50.5],
      ['C', 110.5, 50.5, 110.5, 60.5, 120.5, 60.5],
      ['L', 120.5, 60.5],
    ]);
  });
});

describe('CAIRO_GAL_BASE: groups (cairo_gal.cpp:818-980)', () => {
  it('draws while recording, keeps the state changes, and replays them', () => {
    const gal = strokeGal();
    const g = gal.BeginGroup();
    gal.SetStrokeColor(GREEN);
    gal.SetLineWidth(1.5);
    gal.Translate({ x: 10, y: 0 });
    gal.DrawLine({ x: 0, y: 0 }, { x: 10, y: 0 });
    gal.EndGroup();

    // flushPath strokes at once, and Translate only records: the line is not moved
    const recorded = paints(gal.canvas.log);
    expect(recorded.map((p) => [p.path, p.style, p.lineWidth])).toEqual([
      [
        [
          ['M', 100.5, 50.5],
          ['L', 120.5, 50.5],
        ],
        'rgba(0, 255, 0, 1)',
        3,
      ],
    ]);

    gal.SetStrokeColor(BLUE);
    gal.canvas.log.length = 0;
    gal.DrawGroup(g);

    // The stored path is empty (the stroke took it), so the replay paints nothing,
    // but it puts back the colour, sets Cairo's pen to the WORLD width, and translates.
    expect(paints(gal.canvas.log)).toEqual([]);
    expect(gal.GetStrokeColor()).toEqual(GREEN);
    expect(cairo_get_line_width(gal.context())).toBe(1.5);
    const m = cairo_matrix_new();
    cairo_get_matrix(gal.context(), m);
    expect([m.x0, m.y0]).toEqual([10, 0]);
  });

  it('keeps a replayed pen at least one device pixel wide (cairo_gal.cpp:870-879)', () => {
    const gal = strokeGal();
    const g = gal.BeginGroup();
    gal.SetLineWidth(1.5);
    gal.EndGroup();
    cairo_scale(gal.context(), 0.25, 0.25);
    gal.DrawGroup(g);
    expect(cairo_get_line_width(gal.context())).toBe(4);
  });

  it('ChangeGroupColor rewrites every colour command', () => {
    const gal = strokeGal();
    const g = gal.BeginGroup();
    gal.SetStrokeColor(GREEN);
    gal.SetFillColor(GREEN);
    gal.EndGroup();
    gal.ChangeGroupColor(g, BLUE);
    gal.SetStrokeColor(RED);
    gal.SetFillColor(RED);
    gal.DrawGroup(g);
    expect([gal.GetStrokeColor(), gal.GetFillColor()]).toEqual([BLUE, BLUE]);
  });

  it('a stored fill path is filled in the fill colour at the STROKE alpha (cairo_gal.cpp:889-894)', () => {
    const gal = new TEST_GAL().frame();
    gal.SetIsFill(true);
    gal.SetIsStroke(false);
    const g = gal.BeginGroup();
    gal.SetFillColor({ r: 0, g: 1, b: 0, a: 0.2 });
    gal.SetStrokeColor({ r: 1, g: 0, b: 0, a: 0.8 });
    gal.leavePath();
    gal.EndGroup();
    gal.canvas.log.length = 0;
    gal.DrawGroup(g);
    expect(paints(gal.canvas.log).map((p) => [p.kind, p.path, p.style])).toEqual([
      [
        'fill',
        [
          ['M', 1, 1],
          ['L', 5, 1],
          ['L', 5, 5],
        ],
        `rgba(0, 255, 0, ${204 / 255})`,
      ],
    ]);
  });

  it('numbers groups from a counter that does not reuse a deleted number', () => {
    const gal = strokeGal();
    const a = gal.BeginGroup();
    gal.EndGroup();
    const b = gal.BeginGroup();
    gal.EndGroup();
    gal.DeleteGroup(a);
    const c = gal.BeginGroup();
    gal.EndGroup();
    expect([a, b, c]).toEqual([0, 1, 2]);
  });
});

describe('CAIRO_GAL: the window', () => {
  let factory: ReturnType<typeof installSurfaceFactory>;

  beforeEach(() => {
    factory = installSurfaceFactory();
  });

  afterEach(() => factory.restore());

  function windowOn(aClient: FakeCanvas | null): CAIRO_GAL_WINDOW {
    return {
      GetContext2D: () => aClient?.ctx ?? null,
      GetClientSize: () => ({ x: 40, y: 30 }),
      GetNativePixelSize: () => ({ x: 80, y: 60 }),
      IsShownOnScreen: () => true,
      Refresh: () => {},
      SetCursor: () => {},
      PostPaint: () => {},
    };
  }

  it('will not start on a canvas that holds another context', () => {
    expect(() => new CAIRO_GAL(new GAL_DISPLAY_OPTIONS(), windowOn(null))).toThrow();
  });

  it('draws into the main buffer and blits the composite, scaled to the backing store (cairo_gal.cpp:1432-1496)', () => {
    const client = fakeCanvas('client');
    const gal = new CAIRO_GAL(new GAL_DISPLAY_OPTIONS(), windowOn(client));
    gal.BeginDrawing();
    gal.SetIsStroke(true);
    gal.SetIsFill(false);
    gal.SetStrokeColor(RED);
    gal.DrawLine({ x: 0, y: 0 }, { x: 0, y: 0 });
    gal.EndDrawing();

    const [bitmap, main, overlay, temp] = factory.surfaces;
    // the bitmap, then setCompositor's three buffers, all at the client size
    expect(factory.surfaces.map((s) => [s.w, s.h])).toEqual([
      [40, 30],
      [40, 30],
      [40, 30],
      [40, 30],
    ]);
    expect(paints(main!.canvas.log).map((p) => p.style)).toEqual(['rgba(255, 0, 0, 1)']);
    expect(paints(overlay!.canvas.log)).toEqual([]);
    expect(paints(temp!.canvas.log)).toEqual([]);
    // main, then overlay, painted over the cleared bitmap
    expect(calls(bitmap!.canvas.log, 'drawImage')).toEqual([
      ['drawImage', main!.canvas.image, 0, 0],
      ['drawImage', overlay!.canvas.image, 0, 0],
    ]);
    expect(calls(client.log, 'fillRect', 'drawImage')).toEqual([
      ['fillRect', 0, 0, 80, 60],
      ['drawImage', bitmap!.canvas.image, 0, 0, 40, 30, 0, 0, 80, 60],
    ]);
  });

  it('composites the diff layer with DIFFERENCE and a negatives layer with OVER (cairo_gal.cpp:989-1012)', () => {
    const client = fakeCanvas('client');
    const gal = new CAIRO_GAL(new GAL_DISPLAY_OPTIONS(), windowOn(client));
    gal.BeginDrawing();
    const [, main, , temp] = factory.surfaces;

    gal.StartDiffLayer();
    expect(gal.GetTarget()).toBe(RENDER_TARGET.TARGET_TEMP);
    expect(calls(temp!.canvas.log, 'clearRect')).toEqual([['clearRect', 0, 0, 40, 30]]);
    gal.EndDiffLayer();
    gal.StartNegativesLayer();
    gal.EndNegativesLayer();

    const composites = main!.canvas.log.filter(
      ([n, v]) => n === 'drawImage' || (n === '=globalCompositeOperation' && v !== 'source-over'),
    );
    expect(composites).toEqual([
      ['=globalCompositeOperation', 'difference'],
      ['drawImage', temp!.canvas.image, 0, 0],
      ['drawImage', temp!.canvas.image, 0, 0],
    ]);
  });

  it('blits the small crosshair, 80 px across, onto the frame (cairo_gal.cpp:1204-1236)', () => {
    const client = fakeCanvas('client');
    const gal = new CAIRO_GAL(new GAL_DISPLAY_OPTIONS(), windowOn(client));
    gal.SetCursorEnabled(true);
    gal.BeginDrawing();
    gal.DrawCursor({ x: 0, y: 0 });
    gal.EndDrawing();
    const [bitmap] = factory.surfaces;
    // the world origin is the screen centre (20, 15)
    expect(paints(bitmap!.canvas.log).map((p) => [p.path, p.style, p.lineWidth])).toContainEqual([
      [
        ['M', -19.5, 15.5],
        ['L', 60.5, 15.5],
      ],
      'rgb(255, 255, 255)',
      1,
    ]);
  });
});

describe('EDA_DRAW_PANEL_GAL: Cairo as the fallback (draw_panel_gal.cpp:589-660)', () => {
  let factory: ReturnType<typeof installSurfaceFactory>;

  beforeEach(() => {
    factory = installSurfaceFactory();
  });

  afterEach(() => factory.restore());

  interface PANEL_PEEK {
    SwitchBackend(aType: GAL_TYPE): boolean;
    m_gal: GAL | null;
    m_backend: GAL_TYPE;
  }

  function panel(aHasGl: boolean): PANEL_PEEK {
    const ctx2d = fakeCanvas('client').ctx;
    const p = Object.create(EDA_DRAW_PANEL_GAL.prototype) as PANEL_PEEK & Record<string, unknown>;
    Object.assign(p, {
      window: {
        canvas: { getContext: (aType: string) => (aType === '2d' && !aHasGl ? ctx2d : null) },
      },
      m_gl: aHasGl ? ({} as WebGL2RenderingContext) : null,
      m_ctx2d: null,
      m_gal: null,
      m_view: null,
      m_painter: null,
      m_backend: GAL_TYPE.GAL_TYPE_NONE,
      m_options: new GAL_DISPLAY_OPTIONS(),
      StopDrawing: () => {},
      SetCurrentCursor: () => {},
      Refresh: () => {},
      GetClientSize: () => ({ x: 40, y: 30 }),
      resizeBackingStore: () => false,
    });
    return p;
  }

  it('is Cairo, as on the Linux build', () => {
    expect(EDA_DRAW_PANEL_GAL.GAL_FALLBACK).toBe(GAL_TYPE.GAL_TYPE_CAIRO);
    expect(EDA_DRAW_PANEL_GAL.GAL_FALLBACK_AVAILABLE).toBe(true);
  });

  it('takes over when the canvas has no WebGL2', () => {
    const p = panel(false);
    expect(p.SwitchBackend(GAL_TYPE.GAL_TYPE_OPENGL)).toBe(true);
    expect(p.m_gal).toBeInstanceOf(CAIRO_GAL);
    expect(p.m_backend).toBe(GAL_TYPE.GAL_TYPE_CAIRO);
  });

  it('cannot be had on a canvas holding WebGL: a dummy GAL, as when the backend throws', () => {
    const p = panel(true);
    expect(p.SwitchBackend(GAL_TYPE.GAL_TYPE_CAIRO)).toBe(false);
    expect(p.m_gal).not.toBeInstanceOf(CAIRO_GAL);
    expect(p.m_backend).toBe(GAL_TYPE.GAL_TYPE_NONE);
  });
});
