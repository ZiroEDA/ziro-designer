// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIGFX::PREVIEW::POLYGON_ITEM::drawPreviewShape`
 * (`common/preview_items/polygon_item.cpp:76-110`), plus the two colours
 * `SIMPLE_OVERLAY_ITEM::setupGal` puts up first.
 *
 * Every assertion here is a decision our hand-rolled preview got wrong: it
 * stroked the *layer* colour at the *layer's* line width, drew no fill at all,
 * gave the leader no colour of its own, and drew the loop chain as a 40%-alpha
 * hint. Upstream strokes white at one pixel, fills the ring at alpha 0.2, and
 * never strokes the loop.
 */
import { describe, expect, it } from 'vitest';
import { drawPolygonItem } from '@ziroeda/designer/src/ui/polygon_item.js';

interface Call {
  op: string;
  args: number[];
  /** The stroke/fill colour in force when the op ran. */
  stroke: string;
  fill: string;
  width: number;
}

function recorder(): CanvasRenderingContext2D & { calls: Call[] } {
  const calls: Call[] = [];
  let stroke = '';
  let fill = '';
  let width = 0;
  const push = (op: string, args: number[] = []): number =>
    calls.push({ op, args, stroke, fill, width });
  const ctx = {
    calls,
    set strokeStyle(v: string) {
      stroke = v;
    },
    set fillStyle(v: string) {
      fill = v;
    },
    set lineWidth(v: number) {
      width = v;
    },
    save: () => {},
    restore: () => {},
    setTransform: () => {},
    beginPath: () => push('beginPath'),
    moveTo: (...a: number[]) => push('moveTo', a),
    lineTo: (...a: number[]) => push('lineTo', a),
    closePath: () => push('closePath'),
    stroke: () => push('stroke'),
    fill: () => push('fill'),
  };
  return ctx as unknown as CanvasRenderingContext2D & { calls: Call[] };
}

const LOCKED = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
];
const LEADER = [
  { x: 10, y: 10 },
  { x: 20, y: 20 },
];
const LOOP = [
  { x: 20, y: 20 },
  { x: 20, y: 0 },
  { x: 0, y: 0 },
];

const WHITE = '#ffffff';
const AUX = 'rgb(255, 255, 0)';
const FILL = 'rgba(200, 52, 52, 0.2)';

function draw(over: Partial<Parameters<typeof drawPolygonItem>[1]> = {}): Call[] {
  const ctx = recorder();
  drawPolygonItem(ctx, {
    locked: LOCKED,
    leader: LEADER,
    loop: LOOP,
    // Doubling makes it obvious the path is in device space, not world space.
    toPx: (p) => ({ x: p.x * 2, y: p.y * 2 }),
    strokeColor: WHITE,
    leaderColor: AUX,
    fillColor: FILL,
    devicePixelRatio: 1,
    ...over,
  });
  return ctx.calls;
}

/** The path ops between one beginPath and the terminating stroke/fill. */
function subpaths(calls: Call[]): { end: Call; points: number[][] }[] {
  const out: { end: Call; points: number[][] }[] = [];
  let points: number[][] = [];
  for (const c of calls) {
    if (c.op === 'beginPath') points = [];
    else if (c.op === 'moveTo' || c.op === 'lineTo') points.push(c.args);
    else if (c.op === 'stroke' || c.op === 'fill') out.push({ end: c, points });
  }
  return out;
}

describe('POLYGON_ITEM::drawPreviewShape', () => {
  it('strokes the locked chain white, the leader in LAYER_AUX_ITEMS, and fills last', () => {
    const paths = subpaths(draw());

    expect(paths.map((p) => p.end.op)).toEqual(['stroke', 'stroke', 'fill']);
    // `m_lineColor` is never set, so `setupGal`'s white survives for the
    // locked chain; `m_leaderColor` is never set either, so the leader falls
    // back to `GetLayerColor( LAYER_AUX_ITEMS )`.
    expect(paths[0]!.end.stroke).toBe(WHITE);
    expect(paths[1]!.end.stroke).toBe(AUX);
    // `SetIsStroke( false )` then `DrawPolygon` — the fill is painted *over*
    // the outline, not under it.
    expect(paths[2]!.end.fill).toBe(FILL);
  });

  it('never strokes the loop chain, but does include it in the fill', () => {
    const paths = subpaths(draw());

    // Two stroked chains only: locked and leader.
    expect(paths[0]!.points).toEqual([
      [0, 0],
      [20, 0],
      [20, 20],
    ]);
    expect(paths[1]!.points).toEqual([
      [20, 20],
      [40, 40],
    ]);
    // The fill is locked ++ leader ++ loop with consecutive duplicates
    // dropped, the way `SHAPE_POLY_SET::Append` drops them: (10,10) and
    // (20,20) each appear once, not twice.
    expect(paths[2]!.points).toEqual([
      [0, 0],
      [20, 0],
      [20, 20],
      [40, 40],
      [40, 0],
      [0, 0],
    ]);
  });

  it('closes the fill contour', () => {
    const calls = draw();
    const closes = calls.filter((c) => c.op === 'closePath');
    expect(closes).toHaveLength(1);
    // Between the last lineTo and the fill.
    expect(calls[calls.indexOf(closes[0]!) + 1]!.op).toBe('fill');
  });

  it('strokes one device pixel, whatever the zoom', () => {
    // `gal.SetLineWidth( aView->ToWorld( POLY_LINE_WIDTH ) )` with
    // POLY_LINE_WIDTH = 1: a screen width, so the huge `toPx` scale below must
    // not change it.
    const paths = subpaths(draw({ toPx: (p) => ({ x: p.x * 1000, y: p.y * 1000 }) }));
    expect(paths[0]!.end.width).toBe(1);
  });

  it('floors a fractional device-pixel ratio to a whole pixel', () => {
    // The GAL shader's `u_minLinePixelWidth`.
    const paths = subpaths(draw({ devicePixelRatio: 0.25 }));
    expect(paths[0]!.end.width).toBe(1);
  });

  it('rounds a HiDPI ratio the way the shader does', () => {
    const paths = subpaths(draw({ devicePixelRatio: 2 }));
    expect(paths[0]!.end.width).toBe(2);
  });

  it('skips the locked stroke below two points, but still fills', () => {
    // `if( m_lockedChain.PointCount() >= 2 )`.
    const paths = subpaths(draw({ locked: [{ x: 0, y: 0 }], loop: [] }));
    expect(paths.map((p) => p.end.op)).toEqual(['stroke', 'fill']);
    expect(paths[0]!.end.stroke).toBe(AUX);
  });

  it('draws nothing at all before the first corner', () => {
    expect(draw({ locked: [], leader: [], loop: [] })).toEqual([]);
  });
});
