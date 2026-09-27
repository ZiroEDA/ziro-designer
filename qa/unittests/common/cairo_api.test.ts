// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `common/gal/cairo/cairo_api.ts`, Cairo's semantics on a Canvas 2D context.
 *
 * Every expectation here was put to the installed libcairo 1.18.0 through
 * pycairo - `qa/probes/cairo_semantics_probe.py`, whose numbered cases the
 * comments cite - and restated as the canvas calls that produce the same
 * geometry.
 */

import { describe, expect, it } from 'vitest';
import {
  cairo_append_path,
  cairo_arc,
  cairo_arc_negative,
  cairo_close_path,
  cairo_copy_path,
  cairo_create,
  cairo_device_to_user_distance,
  cairo_fill,
  cairo_fill_preserve,
  cairo_get_line_width,
  cairo_identity_matrix,
  cairo_image_surface_create_for_data,
  cairo_format_t,
  cairo_line_to,
  cairo_matrix_multiply,
  cairo_matrix_new,
  cairo_matrix_rotate,
  cairo_matrix_scale,
  cairo_matrix_translate,
  cairo_move_to,
  cairo_new_path,
  cairo_new_sub_path,
  cairo_operator_t,
  cairo_rectangle,
  cairo_restore,
  cairo_save,
  cairo_scale,
  cairo_set_line_width,
  cairo_set_operator,
  cairo_set_source_rgba,
  cairo_stroke,
  cairo_translate,
  cairoChannelByte,
} from '@ziroeda/common/gal/cairo/cairo_api.js';
import { fakeCanvas, paints, r9 } from './cairo_test_canvas.js';

const PI = Math.PI;

function context() {
  const canvas = fakeCanvas('page');
  const cr = cairo_create(
    cairo_image_surface_create_for_data(canvas, cairo_format_t.CAIRO_FORMAT_ARGB32, 100, 100, 400),
  );
  return { canvas, cr };
}

describe('cairo_matrix_*', () => {
  it('multiply applies a first, then b (probe 7)', () => {
    const r = cairo_matrix_new();
    cairo_matrix_multiply(
      r,
      { xx: 2, yx: 0, xy: 0, yy: 3, x0: 10, y0: 20 },
      { xx: 0, yx: 1, xy: -1, yy: 0, x0: 5, y0: 7 },
    );
    expect(r).toEqual({ xx: 0, yx: 2, xy: -3, yy: 0, x0: -15, y0: 17 });
  });

  it('rotate then translate translates in the rotated space (probe 7)', () => {
    const m = cairo_matrix_new();
    cairo_matrix_rotate(m, 0.3);
    cairo_matrix_translate(m, 4, 5);
    expect([m.xx, m.yx, m.xy, m.yy, m.x0, m.y0].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([
      0.955336489, 0.295520207, -0.295520207, 0.955336489, 2.343744923, 5.958763272,
    ]);
  });

  it('scale keeps the translation (probe 7)', () => {
    const m = { xx: 2, yx: 0, xy: 0, yy: 2, x0: 1, y0: 1 };
    cairo_matrix_scale(m, 3, 5);
    expect(m).toEqual({ xx: 6, yx: 0, xy: 0, yy: 10, x0: 1, y0: 1 });
  });

  it('device_to_user_distance is the inverse CTM without translation (probe 9)', () => {
    const { cr } = context();
    cairo_translate(cr, 50, 60);
    cairo_scale(cr, 4, 0.5);
    expect(cairo_device_to_user_distance(cr, 1, 1)).toEqual({ x: 0.25, y: 2 });
  });
});

describe('cairo_arc / cairo_arc_negative', () => {
  it('raises angle2 by a turn when it is below angle1 (probe 1)', () => {
    const { canvas, cr } = context();
    cairo_arc(cr, 50, 50, 10, 1.0, 0.5);
    cairo_stroke(cr);
    const [p] = paints(canvas.log);
    expect(p!.path).toEqual([
      ['M', r9(50 + 10 * Math.cos(1)), r9(50 + 10 * Math.sin(1))],
      ['A', 50, 50, 10, 1, r9(0.5 + 2 * PI), false],
    ]);
  });

  it('lowers angle2 by a turn when it is above angle1, and runs backwards (probe 3)', () => {
    const { canvas, cr } = context();
    cairo_arc_negative(cr, 50, 50, 10, 0.5, 1.0);
    cairo_stroke(cr);
    const [p] = paints(canvas.log);
    expect(p!.path[1]).toEqual(['A', 50, 50, 10, 0.5, r9(1.0 - 2 * PI), true]);
  });

  it('draws the whole sweep past a full turn, ending where Cairo ends (probe 2)', () => {
    const { canvas, cr } = context();
    cairo_arc(cr, 50, 50, 10, 0, 3 * PI);
    cairo_stroke(cr);
    const [p] = paints(canvas.log);
    const arcs = p!.path.filter((op) => op[0] === 'A');
    // three pieces of pi: 0..pi, pi..2pi, 2pi..3pi; the last ends at 3pi = (40, 50)
    expect(arcs).toEqual([
      ['A', 50, 50, 10, 0, r9(PI), false],
      ['A', 50, 50, 10, r9(PI), r9(2 * PI), false],
      ['A', 50, 50, 10, r9(2 * PI), r9(3 * PI), false],
    ]);
  });

  it('moves to the start after new_sub_path, and lines to it otherwise (probes 5, 6)', () => {
    const { canvas, cr } = context();
    cairo_move_to(cr, 0, 0);
    cairo_line_to(cr, 5, 5);
    cairo_new_sub_path(cr);
    cairo_arc(cr, 50, 50, 10, 0, 0.1);
    cairo_stroke(cr);
    expect(paints(canvas.log)[0]!.path.slice(0, 3)).toEqual([
      ['M', 0, 0],
      ['L', 5, 5],
      ['M', 60, 50],
    ]);
  });

  it('a radius <= 0 is two line_to the centre, the second dropped after a point (probes 4, 18)', () => {
    const { canvas, cr } = context();
    cairo_arc(cr, 50, 50, -3, 0, 1);
    cairo_stroke(cr);
    cairo_move_to(cr, 1, 2);
    cairo_arc(cr, 10, 10, -1, 0, 1);
    cairo_stroke(cr);
    const [a, b] = paints(canvas.log);
    expect(a!.path).toEqual([
      ['M', 50, 50],
      ['L', 50, 50],
    ]);
    expect(b!.path).toEqual([
      ['M', 1, 2],
      ['L', 10, 10],
    ]);
  });
});

describe('paths and painting', () => {
  it('cairo_rectangle is a move, three lines and a close (probe 19)', () => {
    const { canvas, cr } = context();
    cairo_rectangle(cr, 1, 2, 3, 4);
    cairo_fill(cr);
    expect(paints(canvas.log)[0]!.path).toEqual([
      ['M', 1, 2],
      ['L', 4, 2],
      ['L', 4, 6],
      ['L', 1, 6],
      ['Z'],
    ]);
  });

  it('fill clears the path and fill_preserve keeps it (probe 13)', () => {
    const { canvas, cr } = context();
    cairo_move_to(cr, 1, 1);
    cairo_line_to(cr, 5, 1);
    cairo_line_to(cr, 5, 5);
    cairo_fill_preserve(cr);
    cairo_fill(cr);
    cairo_fill(cr);
    expect(paints(canvas.log).map((p) => p.path.length)).toEqual([3, 3]);
  });

  it('save / restore leave the path alone (probe 11)', () => {
    const { canvas, cr } = context();
    cairo_move_to(cr, 1, 1);
    cairo_save(cr);
    cairo_line_to(cr, 2, 2);
    cairo_restore(cr);
    cairo_stroke(cr);
    expect(paints(canvas.log)[0]!.path).toEqual([
      ['M', 1, 1],
      ['L', 2, 2],
    ]);
  });

  it('copy_path is in the copy-time user space; append_path re-transforms it (probe 8)', () => {
    const { canvas, cr } = context();
    cairo_move_to(cr, 10, 10);
    cairo_line_to(cr, 20, 10);
    cairo_translate(cr, 5, 0);
    const path = cairo_copy_path(cr);
    cairo_new_path(cr);
    cairo_identity_matrix(cr);
    cairo_scale(cr, 2, 2);
    cairo_append_path(cr, path);
    cairo_identity_matrix(cr);
    cairo_set_line_width(cr, 1);
    cairo_stroke(cr);
    expect(paints(canvas.log)[0]!.path).toEqual([
      ['M', 10, 20],
      ['L', 30, 20],
    ]);
  });

  it('a pen of width 0 strokes nothing, and a negative width is 0 (probe 16)', () => {
    const { canvas, cr } = context();
    cairo_set_line_width(cr, -1);
    expect(cairo_get_line_width(cr)).toBe(0);
    cairo_move_to(cr, 0, 10.5);
    cairo_line_to(cr, 20, 10.5);
    cairo_stroke(cr);
    expect(paints(canvas.log)).toEqual([]);
  });

  it('the default pen is 2.0 wide, butt-capped and mitred (probe 10)', () => {
    const { canvas, cr } = context();
    cairo_move_to(cr, 0, 0);
    cairo_line_to(cr, 1, 0);
    cairo_stroke(cr);
    const [p] = paints(canvas.log);
    expect([p!.lineWidth, p!.cap, p!.join]).toEqual([2, 'butt', 'miter']);
  });

  it('SOURCE is bounded: clear under the shape, then add the source (probe 17)', () => {
    const { canvas, cr } = context();
    cairo_set_operator(cr, cairo_operator_t.CAIRO_OPERATOR_SOURCE);
    cairo_set_source_rgba(cr, 0, 0, 1, 0.5);
    cairo_rectangle(cr, 0, 0, 10, 10);
    cairo_fill(cr);
    expect(paints(canvas.log).map((p) => [p.op, p.style])).toEqual([
      ['destination-out', 'rgba(0, 0, 0, 1)'],
      ['lighter', `rgba(0, 0, 255, ${128 / 255})`],
    ]);
  });

  it('CLEAR is an opaque destination-out, whatever the source (probe 15)', () => {
    const { canvas, cr } = context();
    cairo_set_source_rgba(cr, 1, 0, 0, 0.25);
    cairo_set_operator(cr, cairo_operator_t.CAIRO_OPERATOR_CLEAR);
    cairo_rectangle(cr, 0, 0, 10, 10);
    cairo_fill(cr);
    expect(paints(canvas.log).map((p) => [p.op, p.style])).toEqual([
      ['destination-out', 'rgba(0, 0, 0, 1)'],
    ]);
  });

  it("a channel is Cairo's byte, (int)( c * 65535 + 0.5 ) >> 8 (probe 21)", () => {
    // 0.002 is where it parts from COLOR4D::ToColour's c * 255 + 0.5 (which gives 1)
    expect([cairoChannelByte(0.002), cairoChannelByte(0.2), cairoChannelByte(1)]).toEqual([
      0, 51, 255,
    ]);
    const { canvas, cr } = context();
    cairo_set_source_rgba(cr, 0.002, 0.2, 1.5, 1);
    cairo_rectangle(cr, 0, 0, 1, 1);
    cairo_fill(cr);
    expect(paints(canvas.log)[0]!.style).toBe('rgba(0, 51, 255, 1)');
  });

  it('close_path returns the current point to the subpath start (probe 12)', () => {
    const { canvas, cr } = context();
    cairo_move_to(cr, 1, 1);
    cairo_line_to(cr, 5, 1);
    cairo_close_path(cr);
    // with a current point, the arc lines to its start rather than moving
    cairo_arc(cr, 20, 20, 1, 0, 1);
    cairo_stroke(cr);
    const path = paints(canvas.log)[0]!.path;
    expect(path.slice(0, 4)).toEqual([
      ['M', 1, 1],
      ['L', 5, 1],
      ['Z'],
      ['A', 20, 20, 1, 0, 1, false],
    ]);
  });
});
