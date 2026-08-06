// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The WebGL backend's geometry recorder (#449).
 *
 * The property everything else rests on is the one in the last describe block:
 * **the recorded geometry must not depend on the zoom.** If it does, the buffer
 * has to be rebuilt on every zoom step, which is the 70 ms repaint we are
 * moving away from, and the whole exercise buys nothing.
 *
 * There is no GPU here, and there does not need to be. The recorder is the part
 * with the logic in it; the device is a few dozen lines of buffer plumbing.
 */
import { describe, it, expect } from 'vitest';
import { GlRecorder } from '@ziroeda/designer/src/render/gl/recorder.js';
import { Scene, SEGMENT_STRIDE, parseColor } from '@ziroeda/designer/src/render/gl/scene.js';
import {
  arcToPolyline,
  dashPolyline,
  facetsForRadius,
  triangulatePolygon,
} from '@ziroeda/designer/src/render/gl/tessellate.js';

/** The instances of a recorded scene, as readable objects. */
const segments = (
  s: Scene,
): { x0: number; y0: number; x1: number; y1: number; half: number; minPx: number; a: number }[] => {
  const v = s.segments.view();
  const out = [];
  for (let i = 0; i < v.length; i += SEGMENT_STRIDE) {
    out.push({
      x0: v[i]!,
      y0: v[i + 1]!,
      x1: v[i + 2]!,
      y1: v[i + 3]!,
      half: v[i + 4]!,
      minPx: v[i + 5]!,
      a: v[i + 9]!,
    });
  }
  return out;
};

const rec = (opts = {}): { r: GlRecorder; s: Scene } => {
  const s = new Scene();
  return { r: new GlRecorder(s, opts), s };
};

describe('recording strokes', () => {
  it('turns a polyline into one segment per span', () => {
    const { r, s } = rec();
    r.beginPath();
    r.moveTo(0, 0);
    r.lineTo(10, 0);
    r.lineTo(10, 10);
    r.stroke();
    expect(segments(s).map((g) => [g.x0, g.y0, g.x1, g.y1])).toEqual([
      [0, 0, 10, 0],
      [10, 0, 10, 10],
    ]);
  });

  it('closes a closed subpath', () => {
    const { r, s } = rec();
    r.beginPath();
    r.moveTo(0, 0);
    r.lineTo(10, 0);
    r.lineTo(10, 10);
    r.closePath();
    r.stroke();
    // Three spans, the last returning to the start.
    const g = segments(s);
    expect(g).toHaveLength(3);
    expect([g[2]!.x1, g[2]!.y1]).toEqual([0, 0]);
  });

  it('keeps a lone point, which the stroke font draws as a dot', () => {
    const { r, s } = rec();
    r.beginPath();
    r.moveTo(5, 5);
    r.stroke();
    const g = segments(s);
    expect(g).toHaveLength(1);
    expect([g[0]!.x0, g[0]!.y0, g[0]!.x1, g[0]!.y1]).toEqual([5, 5, 5, 5]);
  });

  it('applies the current transform to the points', () => {
    const { r, s } = rec();
    r.translate(100, 200);
    r.beginPath();
    r.moveTo(0, 0);
    r.lineTo(10, 0);
    r.stroke();
    expect(segments(s)[0]).toMatchObject({ x0: 100, y0: 200, x1: 110, y1: 200 });
  });

  it('restores the transform and the styles with the stack', () => {
    const { r, s } = rec();
    r.save();
    r.translate(50, 50);
    r.lineWidth = 999;
    r.restore();
    r.beginPath();
    r.moveTo(0, 0);
    r.lineTo(1, 0);
    r.stroke();
    expect(segments(s)[0]).toMatchObject({ x0: 0, y0: 0 });
  });

  it('carries alpha from globalAlpha', () => {
    const { r, s } = rec();
    r.strokeStyle = '#ffffff';
    r.globalAlpha = 0.5;
    r.beginPath();
    r.moveTo(0, 0);
    r.lineTo(1, 0);
    r.stroke();
    expect(segments(s)[0]!.a).toBeCloseTo(0.5, 5);
  });
});

describe('recording fills', () => {
  it('triangulates a rectangle into two triangles', () => {
    const { r, s } = rec();
    r.fillRect(0, 0, 10, 10);
    expect(s.triangleVertexCount).toBe(6);
  });

  it('ignores a degenerate fill rather than emitting rubbish', () => {
    const { r, s } = rec();
    r.beginPath();
    r.moveTo(0, 0);
    r.lineTo(1, 1);
    r.fill();
    expect(s.triangleVertexCount).toBe(0);
  });
});

describe('the surface the schematic renderer actually uses', () => {
  it('is all present', () => {
    // renderer.ts draws through a structural type, so a missing member is not
    // a compile error at the call site: it is a silent no-op at run time.
    const { r } = rec();
    const used = [
      'setTransform',
      'translate',
      'rotate',
      'scale',
      'save',
      'restore',
      'setLineDash',
      'beginPath',
      'moveTo',
      'lineTo',
      'closePath',
      'rect',
      'arc',
      'bezierCurveTo',
      'stroke',
      'fill',
      'strokeRect',
      'fillRect',
      'fillText',
      'drawImage',
      'clip',
    ];
    for (const m of used) {
      expect(typeof (r as unknown as Record<string, unknown>)[m], m).toBe('function');
    }
    for (const p of [
      'fillStyle',
      'strokeStyle',
      'lineWidth',
      'lineCap',
      'lineJoin',
      'globalAlpha',
      'font',
      'textAlign',
    ]) {
      expect(p in r, p).toBe(true);
    }
  });
});

describe('colour parsing', () => {
  it('reads the forms the renderer emits', () => {
    expect(parseColor('#fff')).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(parseColor('#ff0000')).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(parseColor('#00ff0080').a).toBeCloseTo(128 / 255, 5);
    const c = parseColor('rgba(255, 128, 0, 0.5)');
    expect(c.r).toBe(1);
    expect(c.g).toBeCloseTo(128 / 255, 5);
    expect(c.a).toBe(0.5);
  });

  it('falls back to opaque black rather than throwing', () => {
    // Canvas2D ignores a colour it cannot parse; a renderer that threw on one
    // would take the whole frame down.
    expect(parseColor('not a colour')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });
});

describe('tessellation', () => {
  it('picks arc facets from the world radius, never from the zoom', () => {
    // The zoom is not an input here, and must never become one.
    expect(facetsForRadius(1_000_000)).toBeGreaterThan(facetsForRadius(10_000));
    expect(facetsForRadius(0)).toBe(3);
    expect(facetsForRadius(1e12)).toBeLessThanOrEqual(256);
  });

  it('sweeps an arc the way Canvas2D does', () => {
    const quarter = arcToPolyline(0, 0, 100, 0, Math.PI / 2);
    expect(quarter[0]!.x).toBeCloseTo(100, 6);
    expect(quarter[quarter.length - 1]!.y).toBeCloseTo(100, 6);
    // Counter-clockwise the same endpoints take the long way round, so the
    // polyline is far longer. Getting this backwards draws an arc as its
    // own complement, which is very visible and completely silent.
    const long = arcToPolyline(0, 0, 100, 0, Math.PI / 2, true);
    expect(long.length).toBeGreaterThan(quarter.length);
  });

  it('splits a dashed line by arc length across corners', () => {
    const runs = dashPolyline(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      [10, 10],
    );
    expect(runs.length).toBe(5);
    expect(runs[0]).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
  });

  it('treats an empty or zero pattern as solid', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    expect(dashPolyline(line, [])).toEqual([line]);
    expect(dashPolyline(line, [0, 0])).toEqual([line]);
  });

  it('triangulates a convex polygon completely', () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(triangulatePolygon(sq)).toHaveLength(6);
  });

  it('triangulates a concave polygon completely', () => {
    const l = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 4 },
      { x: 4, y: 4 },
      { x: 4, y: 10 },
      { x: 0, y: 10 },
    ];
    // n - 2 triangles for a simple polygon of n vertices.
    expect(triangulatePolygon(l)).toHaveLength((6 - 2) * 3);
  });

  it('terminates on a self-intersecting polygon instead of spinning', () => {
    const bowtie = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    expect(() => triangulatePolygon(bowtie)).not.toThrow();
  });
});

describe('the property the whole design rests on', () => {
  /** Record the same drawing as if the view were at `scale`. */
  const at = (scale: number): Scene => {
    const s = new Scene();
    const r = new GlRecorder(s, { referenceScale: scale });
    // A world-width stroke, and a "one screen pixel" stroke, which is how
    // renderer.ts asks for a hairline (`1 / g_scale`).
    r.beginPath();
    r.moveTo(0, 0);
    r.lineTo(1000, 0);
    r.lineWidth = 50;
    r.stroke();
    r.beginPath();
    r.moveTo(0, 100);
    r.lineTo(1000, 100);
    r.lineWidth = 1 / scale;
    r.stroke();
    return s;
  };

  it('records identical geometry at every zoom', () => {
    // If this ever fails, the buffer has to be rebuilt on every zoom step and
    // the WebGL backend is no faster than the Canvas2D one it replaced.
    const a = segments(at(0.25));
    const b = segments(at(4));
    expect(a).toEqual(b);
  });

  it('records a hairline as a pixel minimum, not as a world width', () => {
    // `1 / scale` means "one screen pixel". Baking it as a world width would
    // make the line grow as you zoom in, which is exactly wrong, and would
    // make the geometry zoom-dependent.
    const g = segments(at(2));
    const hairline = g.find((x) => x.y0 === 100)!;
    expect(hairline.half).toBe(0);
    expect(hairline.minPx).toBeGreaterThan(0);
  });

  it('records a genuine world width as a world width', () => {
    const g = segments(at(2));
    const thick = g.find((x) => x.y0 === 0)!;
    expect(thick.half).toBe(25);
  });

  it('scales a world width by the transform, not by the view', () => {
    const s = new Scene();
    const r = new GlRecorder(s, { referenceScale: 1 });
    r.scale(2, 2);
    r.lineWidth = 10;
    r.beginPath();
    r.moveTo(0, 0);
    r.lineTo(10, 0);
    r.stroke();
    expect(segments(s)[0]!.half).toBe(10); // 10 * 2 / 2
  });
});
