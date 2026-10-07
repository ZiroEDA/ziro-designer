// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The `Path2D`-shaped recorder behind the board's WebGL port.
 *
 * These are the semantics of `Path2D` that `buildScene` actually depends on. It
 * is worth testing precisely because the failures are silent and geometric: a
 * missing bridge in `arc` is a hairline gap in every pad outline, and a matrix
 * that mutates instead of returning a copy makes footprints drift down the board
 * in placement order. Neither throws, and neither shows up in a type.
 *
 * Coordinates are plain numbers here rather than board units — the recorder is
 * unit-agnostic and testing it in millimetres would only add noise.
 */
import { describe, expect, it } from 'vitest';
import { GlPath } from '@ziroeda/designer/src/render/gl/gl_path.js';

const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) < eps;

describe('GlPath', () => {
  it('records a polyline as one open subpath', () => {
    const p = new GlPath();
    p.moveTo(0, 0);
    p.lineTo(10, 0);
    p.lineTo(10, 10);
    expect(p.subpaths).toHaveLength(1);
    expect(p.subpaths[0]!.closed).toBe(false);
    expect(p.subpaths[0]!.pts).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  it('closePath closes the run and reopens at its first point', () => {
    const p = new GlPath();
    p.moveTo(0, 0);
    p.lineTo(10, 0);
    p.closePath();
    p.lineTo(5, 5);
    // Path2D leaves the current point at the closed subpath's start, so the
    // next lineTo draws from (0,0) — not from (10,0), and not from nowhere.
    expect(p.subpaths[0]!.closed).toBe(true);
    expect(p.subpaths[1]!.pts).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 5 },
    ]);
  });

  it('rect is a closed four-point subpath', () => {
    const p = new GlPath();
    p.rect(1, 2, 10, 20);
    expect(p.subpaths[0]!.closed).toBe(true);
    expect(p.subpaths[0]!.pts).toEqual([
      { x: 1, y: 2 },
      { x: 11, y: 2 },
      { x: 11, y: 22 },
      { x: 1, y: 22 },
    ]);
  });

  it('arc bridges from the current point', () => {
    // The regression: Canvas2D draws a straight line from the current point to
    // the arc's start. Without it every rounded pad outline has a hairline gap
    // where the straight side meets the corner.
    const p = new GlPath();
    p.moveTo(-50, 0);
    p.arc(0, 0, 10, 0, Math.PI / 2);
    const pts = p.subpaths[0]!.pts;
    expect(pts[0]).toEqual({ x: -50, y: 0 });
    // The point straight after the bridge is the arc's start, (10, 0).
    expect(near(pts[1]!.x, 10)).toBe(true);
    expect(near(pts[1]!.y, 0)).toBe(true);
    // ...and it ends at (0, 10).
    const last = pts[pts.length - 1]!;
    expect(near(last.x, 0)).toBe(true);
    expect(near(last.y, 10)).toBe(true);
  });

  it('roundRect clamps the radius and degenerates to a rect at zero', () => {
    const square = new GlPath();
    // A radius larger than half the box must clamp, not invert the corners.
    square.roundRect(0, 0, 10, 10, 999);
    const pts = square.subpaths[0]!.pts;
    expect(square.subpaths[0]!.closed).toBe(true);
    for (const q of pts) {
      expect(q.x).toBeGreaterThanOrEqual(-1e-9);
      expect(q.x).toBeLessThanOrEqual(10 + 1e-9);
      expect(q.y).toBeGreaterThanOrEqual(-1e-9);
      expect(q.y).toBeLessThanOrEqual(10 + 1e-9);
    }

    const zero = new GlPath();
    zero.roundRect(0, 0, 4, 4, 0);
    expect(zero.subpaths[0]!.pts).toHaveLength(4);
  });

  it('arcTo puts the tangent points where the spec does', () => {
    // A right angle at (10,0) with radius 2: tangents land 2 units back along
    // each leg, at (8,0) and (10,2).
    const p = new GlPath();
    p.moveTo(0, 0);
    p.arcTo(10, 0, 10, 10, 2);
    const pts = p.subpaths[0]!.pts;
    expect(near(pts[1]!.x, 8)).toBe(true);
    expect(near(pts[1]!.y, 0)).toBe(true);
    const last = pts[pts.length - 1]!;
    expect(near(last.x, 10)).toBe(true);
    expect(near(last.y, 2)).toBe(true);
  });

  it('arcTo degrades to a line when no arc fits', () => {
    for (const [x1, y1, x2, y2, r] of [
      [10, 0, 20, 0, 5], // collinear
      [10, 0, 10, 10, 0], // zero radius
      [0, 0, 10, 10, 5], // coincident with the current point
    ] as const) {
      const p = new GlPath();
      p.moveTo(0, 0);
      p.arcTo(x1, y1, x2, y2, r);
      expect(p.subpaths[0]!.pts).toEqual([
        { x: 0, y: 0 },
        { x: x1, y: y1 },
      ]);
    }
  });
});
