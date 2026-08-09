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
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { buildScene } from '@ziroeda/designer/src/editors/pcb/renderBoard.js';
import {
  GlMatrix,
  GlPath,
  GL_PATH_FACTORY,
  asGlPath,
} from '@ziroeda/designer/src/render/gl/gl_path.js';

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

describe('GlMatrix', () => {
  it('translate and rotate return new matrices', () => {
    // The regression this guards: DOMMatrix.translate/rotate are non-mutating
    // (translateSelf/rotateSelf are the mutating pair). If these mutated, the
    // single matrix buildScene chains per pad would accumulate every previous
    // pad's placement, and footprints would drift in placement order.
    const base = new GlMatrix();
    const moved = base.translate(5, 7);
    expect(base.m).toEqual([1, 0, 0, 1, 0, 0]);
    expect(moved.m).toEqual([1, 0, 0, 1, 5, 7]);
    expect(moved).not.toBe(base);
  });

  it('rotates in degrees, as DOMMatrix does', () => {
    const r = new GlMatrix().rotate(90);
    // A quarter turn maps (1,0) to (0,1).
    const [a, b] = r.m;
    expect(near(a, 0)).toBe(true);
    expect(near(b, 1)).toBe(true);
  });
});

describe('GlPath.addPath', () => {
  it('applies the matrix and leaves the source alone', () => {
    const sub = new GlPath();
    sub.moveTo(1, 0);
    sub.lineTo(2, 0);

    const dst = new GlPath();
    dst.addPath(sub, new GlMatrix().translate(10, 20));

    expect(dst.subpaths[0]!.pts).toEqual([
      { x: 11, y: 20 },
      { x: 12, y: 20 },
    ]);
    // Reused across pads, so a shared sub-path must not be moved in place.
    expect(sub.subpaths[0]!.pts).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
  });

  it('composes translate then rotate the way pad placement does', () => {
    const sub = new GlPath();
    sub.moveTo(1, 0);
    const dst = new GlPath();
    // buildScene's exact chain: matrix().translate(at).rotate(-angle).
    dst.addPath(sub, new GlMatrix().translate(100, 100).rotate(90));
    const p = dst.subpaths[0]!.pts[0]!;
    // Rotation happens in the translated frame, so (1,0) lands at (100,101).
    expect(near(p.x, 100)).toBe(true);
    expect(near(p.y, 101)).toBe(true);
  });
});

describe('buildScene through the GL factory', () => {
  const board = (): ReturnType<typeof readBoard> =>
    readBoard(
      parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))
  (net 0 "")
  (net 1 "VCC")
  (segment (start 100 100) (end 120 100) (width 0.25) (layer "F.Cu") (net 1))
  (footprint "R_0805"
    (layer "F.Cu")
    (at 110 110)
    (pad "1" thru_hole circle (at 0 0) (size 1.5 1.5) (drill 0.8)
      (layers "*.Cu") (net 1 "VCC")))
)`),
    );

  it('produces readable geometry for a real board', () => {
    const scene = buildScene(board(), {}, GL_PATH_FACTORY);

    // The track: one stroke bucket keyed by width, holding a two-point run.
    const cu = scene.layers.get('F.Cu');
    expect(cu).toBeDefined();
    const trackWidths = [...cu!.tracks.keys()];
    expect(trackWidths.length).toBeGreaterThan(0);
    const track = asGlPath(cu!.tracks.get(trackWidths[0]!)!);
    expect(track.subpaths.length).toBeGreaterThan(0);
    expect(track.subpaths[0]!.pts.length).toBeGreaterThanOrEqual(2);

    // The pad's drill: placed through a matrix, so this is the end-to-end
    // check that addPath's transform survived the trip through buildScene.
    const holes = asGlPath(scene.padHolesPlated);
    expect(holes.subpaths.length).toBeGreaterThan(0);
    const all = holes.subpaths.flatMap((s) => s.pts);
    expect(all.length).toBeGreaterThan(0);
    // The footprint sits at (110,110) mm, so the drill ring must be centred
    // there — not at the origin, which is where it is built before placement.
    const cx = all.reduce((s, q) => s + q.x, 0) / all.length;
    const cy = all.reduce((s, q) => s + q.y, 0) / all.length;
    expect(Math.abs(cx - 110e6) / 1e6).toBeLessThan(0.5);
    expect(Math.abs(cy - 110e6) / 1e6).toBeLessThan(0.5);
  });
});
