// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIGFX::ORIGIN_VIEWITEM::ViewDraw` (`common/origin_viewitem.cpp:70-105`).
 *
 * One painter, four styles, five callers upstream — the grid origin, the
 * drill/place origin, both grid-helper axes, the pad-properties preview and
 * `SNAP_INDICATOR`. pcbnew here had a private copy that could draw exactly one
 * of the four, so the grid origin had no marker at all: you could move it and
 * see nothing move.
 *
 * The two circled styles are what a user tells the origins apart by, and they
 * differ in a way that is easy to collapse by accident: the circle is drawn
 * before the switch for *both*, but a CIRCLE_X's arms are diagonal and reach
 * √2 · size — poking out past the ring — while a CIRCLE_CROSS's are
 * axis-aligned and stop exactly on it.
 */
import { describe, expect, it } from 'vitest';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import { GAL_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { VIEW } from '@ziroeda/common/view/view.js';
import {
  drawOriginViewItem,
  ORIGIN_VIEWITEM,
  ORIGIN_VIEWITEM_SIZE,
  type OriginMarkerStyle,
} from '@ziroeda/common/origin_viewitem.js';

interface Call {
  op: string;
  args: number[];
}

/** A 2D context stand-in recording every path call and style set. */
function recorder(): CanvasRenderingContext2D & { calls: Call[]; styles: string[] } {
  const calls: Call[] = [];
  const styles: string[] = [];
  const ctx = {
    calls,
    styles,
    set strokeStyle(v: string) {
      styles.push(v);
    },
    set lineWidth(_v: number) {},
    setTransform: () => {},
    beginPath: () => calls.push({ op: 'beginPath', args: [] }),
    moveTo: (...a: number[]) => calls.push({ op: 'moveTo', args: a }),
    lineTo: (...a: number[]) => calls.push({ op: 'lineTo', args: a }),
    arc: (...a: number[]) => calls.push({ op: 'arc', args: a }),
    stroke: () => calls.push({ op: 'stroke', args: [] }),
  };
  return ctx as unknown as CanvasRenderingContext2D & { calls: Call[]; styles: string[] };
}

/** Identity view, so device pixels are the numbers written below. */
const toPx = (p: { x: number; y: number }): { x: number; y: number } => p;

const draw = (
  style: OriginMarkerStyle,
  over: Partial<Parameters<typeof drawOriginViewItem>[1]> = {},
): ReturnType<typeof recorder> => {
  const ctx = recorder();
  drawOriginViewItem(ctx, {
    position: { x: 100, y: 200 },
    toPx,
    style,
    color: 'rgb(1, 2, 3)',
    // An EVEN pen, so `snapPx` lands on whole pixels and the coordinates below
    // read as the geometry rather than as the crispness rule. The odd-pen
    // half-pixel offset is pinned on its own, below.
    lineWidth: 2,
    ...over,
  });
  return ctx;
};

const ops = (c: ReturnType<typeof recorder>, op: string): number[][] =>
  c.calls.filter((x) => x.op === op).map((x) => x.args);

const S = ORIGIN_VIEWITEM_SIZE;

describe('the four MARKER_STYLEs', () => {
  it('CROSS draws two axis-aligned arms and no circle', () => {
    const c = draw('cross');

    expect(ops(c, 'arc')).toHaveLength(0);
    expect(ops(c, 'moveTo')).toEqual([
      [100 - S, 200],
      [100, 200 - S],
    ]);
    expect(ops(c, 'lineTo')).toEqual([
      [100 + S, 200],
      [100, 200 + S],
    ]);
  });

  it('CIRCLE_CROSS is the same arms plus a ring of the same radius', () => {
    // `gal->DrawCircle( m_position, fabs( scaledSize.x ) )` — the radius is the
    // size, so the axis-aligned arms end exactly on the ring.
    const c = draw('circle_cross');

    expect(ops(c, 'arc')[0]!.slice(0, 3)).toEqual([100, 200, S]);
    expect(ops(c, 'moveTo')).toContainEqual([100 - S, 200]);
    expect(ops(c, 'lineTo')).toContainEqual([100, 200 + S]);
  });

  it('CIRCLE_X is a ring with DIAGONAL arms, which reach past it', () => {
    // `DrawLine( m_position - scaledSize, m_position + scaledSize )`, then the
    // same with `scaledSize.y` negated: both arms move in x and y at once.
    // This is what distinguishes the grid origin from the drill origin.
    const c = draw('circle_x');

    expect(ops(c, 'arc')[0]!.slice(0, 3)).toEqual([100, 200, S]);
    expect(ops(c, 'moveTo')).toEqual([
      [100 - S, 200 - S],
      [100 - S, 200 + S],
    ]);
    expect(ops(c, 'lineTo')).toEqual([
      [100 + S, 200 + S],
      [100 + S, 200 - S],
    ]);
    // And they are genuinely diagonal, not the axis-aligned pair above.
    expect(ops(c, 'moveTo')).not.toContainEqual([100 - S, 200]);
  });

  it('NO_GRAPHIC draws nothing at all', () => {
    // The style `ORIGIN_VIEWITEM( aPosition, flags )` constructs with, used as a
    // position carrier rather than a marker.
    expect(draw('no_graphic').calls).toHaveLength(0);
  });
});

describe('m_drawAtZero', () => {
  it('draws nothing at the world origin by default', () => {
    // "Nothing to do if the target shouldn't be drawn at 0,0 and that's where
    // the target is." Both constructors leave `m_drawAtZero` false, and none of
    // the five callers sets it — which is why a board that never moved its
    // auxiliary origin shows no red marker on the page corner.
    expect(draw('circle_cross', { position: { x: 0, y: 0 } }).calls).toHaveLength(0);
  });

  it('and draws it when the flag is set', () => {
    expect(
      draw('circle_cross', { position: { x: 0, y: 0 }, drawAtZero: true }).calls.length,
    ).toBeGreaterThan(0);
  });

  it('tests the WORLD position, not where it lands on screen', () => {
    // A panned view can put a non-zero origin at device (0, 0) and vice versa.
    // Testing the device point would blink the marker out as the user scrolls.
    const shifted = draw('circle_cross', {
      position: { x: 5, y: 5 },
      toPx: () => ({ x: 0, y: 0 }),
    });

    expect(shifted.calls.length).toBeGreaterThan(0);
  });
});

describe('pixel snapping', () => {
  it('puts an odd pen on a pixel CENTRE and an even one on a boundary', () => {
    // `roundr`/`roundv` in KiCad's kicad_vert.glsl. Without it a one-pixel
    // overlay line spreads across two columns at half strength and reads soft
    // beside pcbnew's — and the default pen here IS one pixel, so this is the
    // common case, not the exotic one.
    expect(
      draw('circle_x', { lineWidth: 1 })
        .calls.find((c) => c.op === 'arc')!
        .args.slice(0, 2),
    ).toEqual([100.5, 200.5]);
    expect(
      draw('circle_x', { lineWidth: 2 })
        .calls.find((c) => c.op === 'arc')!
        .args.slice(0, 2),
    ).toEqual([100, 200]);
  });
});

describe('the rest of ViewDraw', () => {
  it('strokes in the colour the caller hands it', () => {
    // The item carries no theme of its own: `m_color` is a constructor
    // argument, and both pcbnew callers compute it from the frame.
    expect(draw('circle_x').styles).toContain('rgb(1, 2, 3)');
  });

  it('takes the magnitude of a mirrored scale for the radius', () => {
    // `fabs( scaledSize.x )` — a flipped board view carries a negative scale,
    // and a negative radius is not a circle.
    const c = draw('circle_x', { toPx: (p) => ({ x: -p.x, y: p.y }) });

    expect(c.calls.find((x) => x.op === 'arc')!.args[2]).toBe(S);
  });

  it('skips a marker that lands off the canvas', () => {
    expect(draw('circle_x', { canvasWidth: 50, canvasHeight: 50 }).calls).toHaveLength(0);
  });
});

// ----- ORIGIN_VIEWITEM::ViewDraw on a GAL (common/origin_viewitem.cpp:73-114) -----

class LINE_GAL extends GAL {
  calls: string[] = [];
  strokeColor: Color4d = { r: 0, g: 0, b: 0, a: 0 };
  constructor() {
    super(new GAL_DISPLAY_OPTIONS());
    this.ResizeScreen(1000, 1000);
  }
  override ResizeScreen(aWidth: number, aHeight: number): void {
    this.m_screenSize = { x: aWidth, y: aHeight };
    this.ComputeWorldScreenMatrix();
  }
  override SetStrokeColor(aColor: Color4d): void {
    this.strokeColor = aColor;
    super.SetStrokeColor(aColor);
  }
  override DrawLine(a: { x: number; y: number }, b: { x: number; y: number }): void {
    this.calls.push(`line ${a.x},${a.y} ${b.x},${b.y}`);
  }
  override DrawCircle(c: { x: number; y: number }, r: number): void {
    this.calls.push(`circle ${c.x},${c.y} ${r}`);
  }
}

function viewOn(): { view: VIEW; gal: LINE_GAL } {
  const gal = new LINE_GAL();
  const view = new VIEW();
  view.SetGAL(gal);
  return { view, gal };
}

/** `aView->ToWorld( VECTOR2D( aSize, aSize ), false )`: the marker size in world units. */
function worldSize(aView: VIEW, aSize: number): { x: number; y: number } {
  return aView.ToWorld({ x: aSize, y: aSize }, false);
}

describe('ORIGIN_VIEWITEM::ViewDraw', () => {
  const RED = { r: 0.8, g: 0, b: 0, a: 1 };

  it('draws nothing at (0, 0) unless told to draw at zero', () => {
    const { view, gal } = viewOn();
    new ORIGIN_VIEWITEM(RED, 'circle_x', 16, { x: 0, y: 0 }).ViewDraw(0, view);
    expect(gal.calls).toEqual([]);

    const atZero = new ORIGIN_VIEWITEM(RED, 'cross', 16, { x: 0, y: 0 });
    atZero.SetDrawAtZero(true);
    atZero.ViewDraw(0, view);
    expect(gal.calls).toHaveLength(2);
  });

  it('CIRCLE_X: a circle of the size, then the two diagonals, in its colour', () => {
    const { view, gal } = viewOn();
    new ORIGIN_VIEWITEM(RED, 'circle_x', 16, { x: 100, y: 50 }).ViewDraw(0, view);
    const w = worldSize(view, 16);
    expect(gal.calls).toEqual([
      `circle 100,50 ${Math.abs(w.x)}`,
      `line ${100 - w.x},${50 - w.y} ${100 + w.x},${50 + w.y}`,
      `line ${100 - w.x},${50 + w.y} ${100 + w.x},${50 - w.y}`,
    ]);
    expect(gal.strokeColor).toEqual(RED);
  });

  it('CROSS: the two arms and no circle; CIRCLE_CROSS both', () => {
    const { view, gal } = viewOn();
    new ORIGIN_VIEWITEM(RED, 'cross', 10, { x: 100, y: 50 }).ViewDraw(0, view);
    const w = worldSize(view, 10);
    expect(gal.calls).toEqual([
      `line ${100 - w.x},50 ${100 + w.x},50`,
      `line 100,${50 - w.y} 100,${50 + w.y}`,
    ]);
    gal.calls = [];
    new ORIGIN_VIEWITEM(RED, 'circle_cross', 10, { x: 100, y: 50 }).ViewDraw(0, view);
    expect(gal.calls[0]).toBe(`circle 100,50 ${Math.abs(w.x)}`);
    expect(gal.calls).toHaveLength(3);
  });

  it('is on LAYER_GP_OVERLAY and never culled', () => {
    const item = new ORIGIN_VIEWITEM();
    expect(item.ViewGetLayers()).toEqual([GAL_LAYER_ID.LAYER_GP_OVERLAY]);
    expect(item.ViewBBox().GetWidth()).toBeGreaterThan(1e9);
  });
});
