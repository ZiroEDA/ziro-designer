// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { describe, it, expect } from 'vitest';
import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/src/eda_text.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { LINE_STYLE, COLOR4D_BLACK, type Color4d } from '@ziroeda/pcbnew/src/plot_dxf.js';
import {
  COLOR4D_UNSPECIFIED,
  GRAPHICS_IMPORTER,
  GRAPHICS_IMPORTER_BUFFER,
  IMPORTED_STROKE,
  POLY_FILL_RULE,
} from '@ziroeda/common/src/import_gfx/graphics_importer.js';
import {
  NSVG_FLAGS_VISIBLE,
  NSVGfillRule,
  NSVGpaintType,
  nsvgParse,
} from '@ziroeda/common/src/import_gfx/nanosvg.js';
import {
  GatherInterpolatedCubicBezierCurve,
  GatherInterpolatedCubicBezierPath,
  SVG_IMPORT_PLUGIN,
  calculateBezierSegmentationThreshold,
  distanceFromPointToLine,
  getBezierPoint,
} from '@ziroeda/common/src/import_gfx/svg_import_plugin.js';

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

/** One call the plugin made, with the millimetre arguments it made it with. */
type Call =
  | { kind: 'line'; start: Vec2; end: Vec2; stroke: IMPORTED_STROKE }
  | { kind: 'circle'; center: Vec2; radius: number; stroke: IMPORTED_STROKE; filled: boolean }
  | { kind: 'arc'; center: Vec2; start: Vec2; stroke: IMPORTED_STROKE }
  | {
      kind: 'polygon';
      vertices: Vec2[];
      stroke: IMPORTED_STROKE;
      filled: boolean;
      fillColor: Color4d;
    }
  | { kind: 'spline'; start: Vec2; c1: Vec2; c2: Vec2; end: Vec2; stroke: IMPORTED_STROKE };

/**
 * An importer that records what it was handed rather than mapping it onto a
 * board. Asserting here rather than on a round-tripped board is the point: the
 * plugin's whole contract is which `Add…` calls it makes, in what order, with
 * what millimetre coordinates.
 */
class RECORDING_IMPORTER extends GRAPHICS_IMPORTER {
  calls: Call[] = [];

  AddLine(start: Vec2, end: Vec2, stroke: IMPORTED_STROKE): void {
    this.calls.push({ kind: 'line', start, end, stroke });
  }
  AddCircle(
    center: Vec2,
    radius: number,
    stroke: IMPORTED_STROKE,
    filled: boolean,
    _fillColor: Color4d,
  ): void {
    this.calls.push({ kind: 'circle', center, radius, stroke, filled });
  }
  // SVG has no ellipse primitive of its own — nanosvg turns one into cubics —
  // so these exist only to satisfy the base class.
  AddEllipse(): void {
    throw new Error('an SVG import should never produce an ellipse');
  }
  AddEllipseArc(): void {
    throw new Error('an SVG import should never produce an elliptical arc');
  }
  AddArc(center: Vec2, start: Vec2, _angle: EDA_ANGLE, stroke: IMPORTED_STROKE): void {
    this.calls.push({ kind: 'arc', center, start, stroke });
  }
  AddPolygon(vertices: Vec2[], stroke: IMPORTED_STROKE, filled: boolean, fillColor: Color4d): void {
    this.calls.push({ kind: 'polygon', vertices, stroke, filled, fillColor });
  }
  AddText(
    _origin: Vec2,
    _text: string,
    _height: number,
    _width: number,
    _thickness: number,
    _orientation: number,
    _hJustify: GR_TEXT_H_ALIGN_T,
    _vJustify: GR_TEXT_V_ALIGN_T,
    _color: Color4d,
  ): void {
    throw new Error('the SVG plugin never imports text');
  }
  AddSpline(start: Vec2, c1: Vec2, c2: Vec2, end: Vec2, stroke: IMPORTED_STROKE): void {
    this.calls.push({ kind: 'spline', start, c1, c2, end, stroke });
  }
}

/**
 * A document whose user units come out as millimetres 1:1, so every expected
 * coordinate below is readable: 10 user units across a 10 mm wide image.
 */
const doc = (body: string): string =>
  `<svg width="10mm" height="10mm" viewBox="0 0 10 10">${body}</svg>`;

/** Load, import, and hand back what the importer saw. */
const run = (svg: string): Call[] => {
  const plugin = new SVG_IMPORT_PLUGIN();
  const importer = new RECORDING_IMPORTER();

  plugin.SetImporter(importer);
  expect(plugin.LoadFromMemory(svg)).toBe(true);
  expect(plugin.Import()).toBe(true);

  return importer.calls;
};

const close = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) < eps;

/** Does the vertex list contain this point, in any position? */
const hasPoint = (pts: Vec2[], x: number, y: number, eps = 1e-5): boolean =>
  pts.some((p) => close(p.x, x, eps) && close(p.y, y, eps));

const bboxOf = (pts: Vec2[]) => ({
  minX: Math.min(...pts.map((p) => p.x)),
  minY: Math.min(...pts.map((p) => p.y)),
  maxX: Math.max(...pts.map((p) => p.x)),
  maxY: Math.max(...pts.map((p) => p.y)),
});

// ---------------------------------------------------------------------------
// nanosvg: the shapes and the geometry it produces
// ---------------------------------------------------------------------------

describe('nanosvg: primitives become cubic Béziers', () => {
  it('turns a rect into one closed path of four cubics', () => {
    const image = nsvgParse(doc('<rect x="1" y="2" width="4" height="3"/>'), 'mm', 96);

    expect(image.shapes).toHaveLength(1);
    expect(image.shapes[0]!.paths).toHaveLength(1);

    const path = image.shapes[0]!.paths[0]!;

    // moveTo + 3 lineTo = 10 points, plus the closing lineTo = 13.
    expect(path.npts).toBe(13);
    expect(path.closed).toBe(true);
    expect((path.npts - 1) % 3).toBe(0);

    // The corners are the knots: every third point.
    expect(path.pts[0]).toBeCloseTo(1, 9);
    expect(path.pts[1]).toBeCloseTo(2, 9);
    expect(path.pts[6]).toBeCloseTo(5, 9);
    expect(path.pts[7]).toBeCloseTo(2, 9);
    expect(path.pts[12]).toBeCloseTo(5, 9);
    expect(path.pts[13]).toBeCloseTo(5, 9);
  });

  it('puts a straight segment’s control points at the 1/3 marks', () => {
    const image = nsvgParse(doc('<line x1="0" y1="0" x2="9" y2="0"/>'), 'mm', 96);
    const path = image.shapes[0]!.paths[0]!;

    expect(path.npts).toBe(4);
    expect(path.closed).toBe(false);
    expect(path.pts[2]).toBeCloseTo(3, 9);
    expect(path.pts[4]).toBeCloseTo(6, 9);
    expect(path.pts[6]).toBeCloseTo(9, 9);
  });

  it('draws a circle as four KAPPA90 cubics', () => {
    const image = nsvgParse(doc('<circle cx="5" cy="5" r="4"/>'), 'mm', 96);
    const path = image.shapes[0]!.paths[0]!;

    // moveTo + 4 cubics = 13, plus a closing lineTo = 16.
    expect(path.npts).toBe(16);
    expect(path.pts[0]).toBeCloseTo(9, 9);
    expect(path.pts[1]).toBeCloseTo(5, 9);
    // The first handle is `r * KAPPA90` along +Y from (cx + r, cy).
    expect(path.pts[3]).toBeCloseTo(5 + 4 * 0.5522847493, 9);
  });

  it('drops a sub-path with fewer than four points', () => {
    // `M 1 1 Z` is one point: not a complete cubic, so nothing is emitted and
    // the shape has no paths at all.
    const image = nsvgParse(doc('<path d="M 1 1 Z"/>'), 'mm', 96);

    expect(image.shapes).toHaveLength(0);
  });

  it('hands a shape’s sub-paths back in reverse parse order', () => {
    const image = nsvgParse(doc('<path d="M0,0 H4 M0,8 H4"/>'), 'mm', 96);
    const paths = image.shapes[0]!.paths;

    expect(paths).toHaveLength(2);
    // The second sub-path of the `d` attribute comes first.
    expect(paths[0]!.pts[1]).toBeCloseTo(8, 9);
    expect(paths[1]!.pts[1]).toBeCloseTo(0, 9);
  });

  it('splits an elliptical arc into at most 90° cubic segments', () => {
    // A half circle: |da| = pi, so ndivs = trunc( pi / (pi/2) + 1 ) = 3.
    const image = nsvgParse(doc('<path d="M1,5 A4,4 0 0 1 9,5"/>'), 'mm', 96);
    const path = image.shapes[0]!.paths[0]!;

    expect(path.npts).toBe(1 + 3 * 3);
  });

  it('degenerates an arc with a zero radius into a line', () => {
    const image = nsvgParse(doc('<path d="M1,5 A0,0 0 0 1 9,5"/>'), 'mm', 96);
    const path = image.shapes[0]!.paths[0]!;

    expect(path.npts).toBe(4);
    expect(path.pts[2]).toBeCloseTo(1 + 8 / 3, 9);
  });
});

describe('nanosvg: attributes', () => {
  it('reads the ten colour names it has and greys out the rest', () => {
    const red = nsvgParse(doc('<rect width="4" height="4" fill="red"/>'), 'mm', 96);
    // NSVG_RGB is ABGR: red is the low byte.
    expect(red.shapes[0]!.fill.color & 0xffffff).toBe(0x0000ff);

    // `rebeccapurple` is behind NANOSVG_ALL_COLOR_KEYWORDS, which KiCad does
    // not define, so it reads as mid grey.
    const purple = nsvgParse(doc('<rect width="4" height="4" fill="rebeccapurple"/>'), 'mm', 96);
    expect(purple.shapes[0]!.fill.color & 0xffffff).toBe(0x808080);
  });

  it('folds fill-opacity into the top byte of the fill colour', () => {
    const image = nsvgParse(
      doc('<rect width="4" height="4" fill="#ffffff" fill-opacity="0.5"/>'),
      'mm',
      96,
    );

    expect(image.shapes[0]!.fill.color >>> 24).toBe(127);
  });

  it('never un-hides a subtree that an ancestor hid', () => {
    const image = nsvgParse(
      doc('<g display="none"><rect display="inline" width="4" height="4"/></g>'),
      'mm',
      96,
    );

    expect(image.shapes[0]!.flags & NSVG_FLAGS_VISIBLE).toBe(0);
  });

  it('applies a transform and folds its scale into the stroke width', () => {
    const image = nsvgParse(
      doc(
        '<g transform="translate(1,2) scale(2)"><line x1="0" y1="0" x2="3" y2="0" stroke="red" stroke-width="1"/></g>',
      ),
      'mm',
      96,
    );
    const path = image.shapes[0]!.paths[0]!;

    expect(path.pts[0]).toBeCloseTo(1, 9);
    expect(path.pts[1]).toBeCloseTo(2, 9);
    expect(path.pts[6]).toBeCloseTo(7, 9);
    expect(image.shapes[0]!.strokeWidth).toBeCloseTo(2, 9);
  });

  it('treats a gradient reference as no paint at all', () => {
    // Documented gap: gradients are not resolved, which is exactly what
    // upstream does for a reference it cannot find.
    const image = nsvgParse(doc('<rect width="4" height="4" fill="url(#g)"/>'), 'mm', 96);

    expect(image.shapes[0]!.fill.type).toBe(NSVGpaintType.NSVG_PAINT_NONE);
  });

  it('reads fill-rule and a style attribute', () => {
    const image = nsvgParse(
      doc('<rect width="4" height="4" style="fill-rule:evenodd; stroke:red"/>'),
      'mm',
      96,
    );

    expect(image.shapes[0]!.fillRule).toBe(NSVGfillRule.NSVG_FILLRULE_EVENODD);
    expect(image.shapes[0]!.stroke.type).toBe(NSVGpaintType.NSVG_PAINT_COLOR);
  });

  it('applies a .class rule from a <style> element', () => {
    const image = nsvgParse(
      doc('<style>.a { fill: none; stroke: blue }</style><rect class="a" width="4" height="4"/>'),
      'mm',
      96,
    );

    expect(image.shapes[0]!.fill.type).toBe(NSVGpaintType.NSVG_PAINT_NONE);
    expect(image.shapes[0]!.stroke.color & 0xffffff).toBe(0xff0000); // ABGR blue
  });

  it('terminates on a transform given too many arguments', () => {
    // Upstream spins here forever: `parseTransformArgs` returns a length of 0
    // and `str += len` never advances. We stop instead.
    const image = nsvgParse(
      doc('<rect width="4" height="4" transform="translate(1,2,3)"/>'),
      'mm',
      96,
    );

    expect(image.shapes).toHaveLength(1);
  });
});

describe('nanosvg: the viewBox and unit scale', () => {
  it('converts user units to millimetres through the DPI', () => {
    // 96 user units across a 25.4 mm image: 1 user unit is 0.264583 mm.
    const image = nsvgParse(
      '<svg width="1in" height="1in" viewBox="0 0 96 96"><rect x="48" y="0" width="48" height="48"/></svg>',
      'mm',
      96,
    );

    expect(image.width).toBeCloseTo(96, 6);
    expect(image.shapes[0]!.bounds[0]).toBeCloseTo(12.7, 6);
    expect(image.shapes[0]!.bounds[2]).toBeCloseTo(25.4, 6);
  });

  it('honours preserveAspectRatio=none by scaling the axes apart', () => {
    const image = nsvgParse(
      '<svg width="20mm" height="10mm" viewBox="0 0 10 10" preserveAspectRatio="none">' +
        '<rect x="0" y="0" width="10" height="10"/></svg>',
      'mm',
      96,
    );

    expect(image.shapes[0]!.bounds[2]).toBeCloseTo(20, 6);
    expect(image.shapes[0]!.bounds[3]).toBeCloseTo(10, 6);
  });

  it('falls back to the drawing’s own bounds when there is no viewBox', () => {
    const image = nsvgParse('<svg><rect x="2" y="3" width="4" height="5"/></svg>', 'mm', 96);

    // No width/height/viewBox: the image box becomes the content box, so the
    // drawing starts at the origin.
    expect(image.shapes[0]!.bounds[0]).toBeCloseTo(0, 6);
    expect(image.shapes[0]!.bounds[1]).toBeCloseTo(0, 6);
  });
});

// ---------------------------------------------------------------------------
// the flattening rule
// ---------------------------------------------------------------------------

describe('the Bézier subdivision rule', () => {
  it('evaluates a cubic by de Casteljau', () => {
    const pts = [0, 0, 0, 1, 1, 1, 1, 0];

    expect(getBezierPoint(pts, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(getBezierPoint(pts, 0, 1)).toEqual({ x: 1, y: 0 });

    const mid = getBezierPoint(pts, 0, 0.5);
    expect(mid.x).toBeCloseTo(0.5, 12);
    expect(mid.y).toBeCloseTo(0.75, 12);
  });

  it('measures the tolerance over the first THREE control points only', () => {
    // The end point is at x = 100, but the loop stops before it. The box is
    // therefore 0..1 in x and 0..0 in y, and the tolerance is 0.001.
    const runaway = [0, 0, 1, 0, 0, 0, 100, 0];

    expect(calculateBezierSegmentationThreshold(runaway, 0)).toBeCloseTo(0.001, 12);

    // Moving the same extreme coordinate into the third point *does* change it:
    // that is the point the loop is one short of.
    const included = [0, 0, 1, 0, 100, 0, 0, 0];

    expect(calculateBezierSegmentationThreshold(included, 0)).toBeCloseTo(0.1, 12);
  });

  it('takes the larger side of the control box, scaled by a thousandth', () => {
    const tall = [0, 0, 0, 20, 3, 20, 0, 0];

    expect(calculateBezierSegmentationThreshold(tall, 0)).toBeCloseTo(0.02, 12);
  });

  it('falls back to a point distance when the chord degenerates', () => {
    // Without this an entirely closed cubic — start equal to end — would never
    // subdivide, because the perpendicular of a zero vector is zero.
    expect(distanceFromPointToLine({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(
      5,
      12,
    );
    expect(distanceFromPointToLine({ x: 5, y: 2 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(
      2,
      12,
    );
  });

  it('emits only the endpoints for a cubic that is really a straight line', () => {
    // Control points on the chord: every sample lands on it, so no midpoint
    // ever exceeds the tolerance.
    const out: Vec2[] = [];
    GatherInterpolatedCubicBezierCurve([0, 0, 3, 0, 6, 0, 9, 0], 0, out);

    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[1]).toEqual({ x: 9, y: 0 });
  });

  it('subdivides a bowed cubic and returns the points in parameter order', () => {
    const out: Vec2[] = [];
    GatherInterpolatedCubicBezierCurve([0, 0, 0, 10, 10, 10, 10, 0], 0, out);

    expect(out.length).toBeGreaterThan(20);
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[out.length - 1]).toEqual({ x: 10, y: 0 });

    // In-order recursion: x increases monotonically along this curve.
    for (let i = 1; i < out.length; i++) expect(out[i]!.x).toBeGreaterThanOrEqual(out[i - 1]!.x);
  });

  it('halves the parameter step, landing every sample on a dyadic grid', () => {
    const pts = [0, 0, 0, 10, 10, 10, 10, 0];
    const out: Vec2[] = [];

    GatherInterpolatedCubicBezierCurve(pts, 0, out);

    // Five levels of bisection: 32 segments, 33 points.
    expect(out).toHaveLength(33);

    // And they are the curve sampled at exactly k/32. That grid is what
    // halving the step *means*; any other divisor samples elsewhere and
    // emits a different number of points in a different distribution.
    for (let k = 0; k <= 32; k++) {
      const expected = getBezierPoint(pts, 0, k / 32);

      expect(out[k]!.x).toBeCloseTo(expected.x, 9);
      expect(out[k]!.y).toBeCloseTo(expected.y, 9);
    }
  });

  it('declares an S-curve flat, because it samples one point per interval', () => {
    // The criterion compares a *single* sample against the chord. This cubic
    // crosses its own chord exactly at the first sample, t = 0.5, so the
    // distance is zero, the recursion stops before looking anywhere else, and
    // the whole S collapses to its chord. Upstream's, and the reason the rule
    // is a subdivision heuristic rather than a flatness proof.
    const out: Vec2[] = [];

    GatherInterpolatedCubicBezierCurve([0, 0, 10, 0, 0, 10, 10, 10], 0, out);

    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  it('produces the same segment count for a curve scaled up', () => {
    // The tolerance is a thousandth of the curve's own control box, so it
    // scales with the curve and the count does not change.
    const small: Vec2[] = [];
    const large: Vec2[] = [];

    GatherInterpolatedCubicBezierCurve([0, 0, 0, 1, 1, 1, 1, 0], 0, small);
    GatherInterpolatedCubicBezierCurve([0, 0, 0, 100, 100, 100, 100, 0], 0, large);

    expect(large).toHaveLength(small.length);
  });

  it('shares knots between consecutive curves of one path', () => {
    // Two straight cubics sharing the point (9, 0): four points, not five.
    const out: Vec2[] = [];
    GatherInterpolatedCubicBezierPath([0, 0, 3, 0, 6, 0, 9, 0, 9, 3, 9, 6, 9, 9], 7, out);

    expect(out).toHaveLength(3);
    expect(out[1]).toEqual({ x: 9, y: 0 });
    expect(out[2]).toEqual({ x: 9, y: 9 });
  });

  it('walks four points at a time, advancing by three', () => {
    const out: Vec2[] = [];
    // Ten points is three complete cubics; a trailing partial one is ignored.
    const pts = [0, 0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0, 7, 0, 8, 0, 9, 0, 10, 0];

    GatherInterpolatedCubicBezierPath(pts, 11, out);

    expect(out.map((p) => p.x)).toEqual([0, 3, 6, 9]);
  });
});

// ---------------------------------------------------------------------------
// SVG_IMPORT_PLUGIN
// ---------------------------------------------------------------------------

describe('SVG_IMPORT_PLUGIN: fill and stroke decisions', () => {
  it('imports a plain rect as a filled polygon with no stroke', () => {
    const calls = run(doc('<rect x="1" y="2" width="4" height="3"/>'));

    expect(calls).toHaveLength(1);
    const poly = calls[0]!;

    if (poly.kind !== 'polygon') throw new Error('expected a polygon');

    expect(poly.filled).toBe(true);
    // The default fill is opaque black, which the plugin discards as "nanosvg
    // probably didn't read it properly".
    expect(poly.fillColor).toEqual(COLOR4D_UNSPECIFIED);
    // -1 is "no stroke at all", not "default width".
    expect(poly.stroke.GetWidth()).toBe(-1);

    const box = bboxOf(poly.vertices);
    expect(box.minX).toBeCloseTo(1, 4);
    expect(box.minY).toBeCloseTo(2, 4);
    expect(box.maxX).toBeCloseTo(5, 4);
    expect(box.maxY).toBeCloseTo(5, 4);
  });

  it('keeps a fill colour that is not pure black', () => {
    const calls = run(doc('<rect width="4" height="4" fill="red"/>'));
    const poly = calls[0]!;

    if (poly.kind !== 'polygon') throw new Error('expected a polygon');

    expect(poly.fillColor.r).toBeCloseTo(1, 6);
    expect(poly.fillColor.g).toBeCloseTo(0, 6);
    expect(poly.fillColor.a).toBeCloseTo(1, 6);
    expect(poly.fillColor).not.toEqual(COLOR4D_BLACK);
  });

  it('carries the stroke width in millimetres and drops the fill', () => {
    const calls = run(
      doc('<rect width="4" height="4" fill="none" stroke="red" stroke-width="0.5"/>'),
    );

    expect(calls).toHaveLength(1);
    const poly = calls[0]!;

    if (poly.kind !== 'polygon') throw new Error('expected a polygon');

    expect(poly.filled).toBe(false);
    expect(poly.stroke.GetWidth()).toBeCloseTo(0.5, 9);
  });

  it('skips a shape with neither fill nor stroke', () => {
    expect(run(doc('<rect width="4" height="4" fill="none" stroke="none"/>'))).toHaveLength(0);
  });

  it('skips a hidden shape', () => {
    expect(run(doc('<rect width="4" height="4" display="none"/>'))).toHaveLength(0);
  });

  it('treats a fully transparent fill as unfilled', () => {
    // `filled` reads the alpha byte, so opacity 0 leaves an outline only — and
    // with no stroke the path is still closed, so it is still a polygon.
    const calls = run(doc('<rect width="4" height="4" fill="red" fill-opacity="0"/>'));
    const poly = calls[0]!;

    if (poly.kind !== 'polygon') throw new Error('expected a polygon');
    expect(poly.filled).toBe(false);
  });
});

describe('SVG_IMPORT_PLUGIN: closed versus open paths', () => {
  it('emits an open path as one spline per cubic, keeping the control points', () => {
    const calls = run(doc('<path d="M0,0 C0,6 6,6 6,0" fill="none" stroke="red"/>'));

    expect(calls).toHaveLength(1);
    const spline = calls[0]!;

    if (spline.kind !== 'spline') throw new Error('expected a spline');

    expect(spline.start).toEqual({ x: 0, y: 0 });
    expect(spline.c1.y).toBeCloseTo(6, 6);
    expect(spline.end.x).toBeCloseTo(6, 6);
  });

  it('interpolates a closed path into a polygon instead', () => {
    const calls = run(doc('<path d="M0,0 C0,6 6,6 6,0 Z" fill="none" stroke="red"/>'));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.kind).toBe('polygon');
  });

  it('imports a filled OPEN path twice — a closed fill and an open outline', () => {
    const calls = run(doc('<path d="M0,0 L8,0 L8,8" fill="red" stroke="blue" stroke-width="1"/>'));

    // Two straight cubics for the outline, one polygon for the fill. The
    // polygon is emitted last because PostprocessNestedPolygons flushes the
    // group after the shapes that are not polygons have passed through.
    expect(calls.map((c) => c.kind)).toEqual(['spline', 'spline', 'polygon']);

    const outline = calls[0]!;
    if (outline.kind !== 'spline') throw new Error('expected a spline');
    expect(outline.stroke.GetWidth()).toBeCloseTo(1, 9);

    const fill = calls[2]!;
    if (fill.kind !== 'polygon') throw new Error('expected a polygon');
    expect(fill.filled).toBe(true);
    // The fill carries no stroke of its own: that is the outline's job.
    expect(fill.stroke.GetWidth()).toBe(-1);
  });

  it('omits the outline half when the stroke has no width', () => {
    // `stroke` is set but `stroke-width` defaults to 0, so only the fill half
    // of the two-shape split survives.
    const calls = run(doc('<path d="M0,0 L8,0 L8,8" fill="red" stroke="blue"/>'));

    expect(calls.map((c) => c.kind)).toEqual(['polygon']);
  });

  it('implicitly closes a filled open path even without a stroke', () => {
    const calls = run(doc('<path d="M0,0 L8,0 L8,8" fill="red" stroke="none"/>'));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.kind).toBe('polygon');
  });
});

describe('SVG_IMPORT_PLUGIN: dash patterns', () => {
  const dashStyleOf = (dasharray: string, width = 1): LINE_STYLE => {
    const calls = run(
      doc(
        `<rect width="8" height="8" fill="none" stroke="red" stroke-width="${width}" stroke-dasharray="${dasharray}"/>`,
      ),
    );

    return calls[0]!.stroke.GetPlotStyle();
  };

  it('classifies dashes shorter than 1.9 stroke widths as dots', () => {
    expect(dashStyleOf('1 3')).toBe(LINE_STYLE.DOT);
  });

  it('classifies longer dashes as dashes', () => {
    expect(dashStyleOf('4 2')).toBe(LINE_STYLE.DASH);
  });

  it('reads dash-dot and dash-dot-dot from the pattern', () => {
    // Only the even entries — the dashes — are classified. 4 is a dash, 1 a dot.
    expect(dashStyleOf('4 2 1 2')).toBe(LINE_STYLE.DASHDOT);
    expect(dashStyleOf('4 2 1 2 1 2')).toBe(LINE_STYLE.DASHDOTDOT);
  });

  it('leaves an unclassifiable pattern solid', () => {
    // Three dots and one dash matches none of the four cases.
    expect(dashStyleOf('1 2 1 2 1 2 4 2')).toBe(LINE_STYLE.SOLID);
  });

  it('has no dash pattern at all when there is no dasharray', () => {
    const calls = run(
      doc('<rect width="8" height="8" fill="none" stroke="red" stroke-width="1"/>'),
    );

    expect(calls[0]!.stroke.GetPlotStyle()).toBe(LINE_STYLE.SOLID);
  });
});

describe('SVG_IMPORT_PLUGIN: the fill rule and nested sub-paths', () => {
  /** A square with a smaller square inside it, both wound the same way. */
  const nested = (fillRule: string): Call[] =>
    run(doc(`<path fill-rule="${fillRule}" d="M0,0 H10 V10 H0 Z M3,3 H7 V7 H3 Z"/>`));

  it('leaves a nonzero-filled pair of same-wound rings solid', () => {
    const calls = nested('nonzero');

    expect(calls).toHaveLength(1);
    const poly = calls[0]!;
    if (poly.kind !== 'polygon') throw new Error('expected a polygon');

    // Both rings wind the same way, so under nonzero the inner one is not a
    // hole and the union is the outer square: four corners, nothing else.
    expect(poly.vertices.length).toBeLessThanOrEqual(5);
    expect(hasPoint(poly.vertices, 0, 0, 1e-3)).toBe(true);
    expect(hasPoint(poly.vertices, 10, 10, 1e-3)).toBe(true);
    expect(hasPoint(poly.vertices, 3, 3, 1e-3)).toBe(false);
  });

  it('cuts the inner ring open as a hole under evenodd', () => {
    const calls = nested('evenodd');

    expect(calls).toHaveLength(1);
    const poly = calls[0]!;
    if (poly.kind !== 'polygon') throw new Error('expected a polygon');

    // Fractured: the hole is joined to the outline by a slit, so the inner
    // corners appear in the single ring.
    expect(poly.vertices.length).toBeGreaterThan(5);
    expect(hasPoint(poly.vertices, 3, 3, 1e-3)).toBe(true);
    expect(hasPoint(poly.vertices, 7, 7, 1e-3)).toBe(true);
  });

  it('drops a polygon group whose bounding box has no height', () => {
    // `wxCHECK( origH && origW )` returns before anything is emitted.
    const calls = run(doc('<path d="M0,5 H10 Z" fill="red"/>'));

    expect(calls).toHaveLength(0);
  });
});

describe('SVG_IMPORT_PLUGIN: image size', () => {
  it('reports width and height in millimetres', () => {
    const plugin = new SVG_IMPORT_PLUGIN();
    plugin.SetImporter(new RECORDING_IMPORTER());
    plugin.LoadFromMemory('<svg width="1in" height="2in" viewBox="0 0 96 192"/>');

    expect(plugin.GetImageWidth()).toBeCloseTo(25.4, 6);
    expect(plugin.GetImageHeight()).toBeCloseTo(50.8, 6);
  });

  it('merges every shape’s bounds into the image bbox', () => {
    const plugin = new SVG_IMPORT_PLUGIN();
    plugin.SetImporter(new RECORDING_IMPORTER());
    plugin.LoadFromMemory(
      doc('<rect x="1" y="1" width="2" height="2"/><rect x="6" y="7" width="3" height="2"/>'),
    );

    const bbox = plugin.GetImageBBox();

    expect(bbox.GetLeft()).toBeCloseTo(1, 5);
    expect(bbox.GetTop()).toBeCloseTo(1, 5);
    expect(bbox.GetRight()).toBeCloseTo(9, 5);
    expect(bbox.GetBottom()).toBeCloseTo(9, 5);
  });

  it('returns an invalid box for a document with no shapes', () => {
    const plugin = new SVG_IMPORT_PLUGIN();
    plugin.SetImporter(new RECORDING_IMPORTER());
    plugin.LoadFromMemory('<svg width="10mm" height="10mm" viewBox="0 0 10 10"/>');

    expect(plugin.GetImageBBox().IsValid()).toBe(false);
  });

  it('refuses to load without an importer, and to import without a load', () => {
    const plugin = new SVG_IMPORT_PLUGIN();

    expect(plugin.LoadFromMemory(doc('<rect width="4" height="4"/>'))).toBe(false);
    expect(plugin.Import()).toBe(false);
    expect(plugin.GetName()).toBe('Scalable Vector Graphics');
    expect(plugin.GetFileExtensions()).toEqual(['svg']);
  });

  it('collects messages with a trailing newline each', () => {
    const plugin = new SVG_IMPORT_PLUGIN();

    plugin.ReportMsg('first');
    plugin.ReportMsg('second');

    expect(plugin.GetMessages()).toBe('first\nsecond\n');
  });
});

describe('GRAPHICS_IMPORTER_BUFFER.PostprocessNestedPolygons', () => {
  const stroke = new IMPORTED_STROKE(0.2, LINE_STYLE.SOLID, COLOR4D_UNSPECIFIED);

  it('leaves shapes that are not polygons exactly where they were', () => {
    const buffer = new GRAPHICS_IMPORTER_BUFFER();

    buffer.AddLine({ x: 0, y: 0 }, { x: 1, y: 1 }, stroke);
    buffer.AddSpline({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, stroke);
    buffer.PostprocessNestedPolygons();

    expect(buffer.GetShapes()).toHaveLength(2);
  });

  it('passes a polygon with no parent shape straight through', () => {
    const buffer = new GRAPHICS_IMPORTER_BUFFER();

    // No NewShape call: the parent index is -1.
    buffer.AddPolygon(
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
      ],
      stroke,
      true,
      COLOR4D_UNSPECIFIED,
    );
    buffer.PostprocessNestedPolygons();

    expect(buffer.GetShapes()).toHaveLength(1);
  });

  it('keeps a sub-path of fewer than three vertices verbatim', () => {
    const buffer = new GRAPHICS_IMPORTER_BUFFER();

    buffer.NewShape(POLY_FILL_RULE.PF_NONZERO);
    buffer.AddPolygon(
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
      ],
      stroke,
      true,
      COLOR4D_UNSPECIFIED,
    );
    buffer.AddPolygon(
      [
        { x: 8, y: 8 },
        { x: 9, y: 9 },
      ],
      stroke,
      true,
      COLOR4D_UNSPECIFIED,
    );
    buffer.PostprocessNestedPolygons();

    // One converted outline plus the two-point path, re-emitted as it was.
    expect(buffer.GetShapes()).toHaveLength(2);
  });
});
