// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A hairline is drawn solid only when it runs along a device axis.
 *
 * KiCad's line fragment shader has no antialiasing in it at all: `drawLine` in
 * `common/gal/shaders/kicad_frag.glsl` is `isPixelInSegment( coord ) != 0 ?
 * gl_Color : discard`, a coverage BIT. What smooths KiCad's diagonals is the
 * SMAA post-pass, on by default because `graphics.antialiasing_mode` is
 * AA_HIGHQUALITY (`common_settings.cpp:328-329`) — and SMAA reshapes staircase
 * edges only where there is a staircase, i.e. never on a vertical or horizontal
 * one.
 *
 * So the rule that matches KiCad is "an axis-aligned hairline is solid", not
 * "a hairline is solid". Ours was the second, which left every diagonal in the
 * drawing sheet, schematic, board and Gerber view a hard staircase.
 *
 * Measured from a pl_editor screenshot and a ZiroEDA one of the same selected
 * diagonal at the same page (2026-08-24): KiCad varies per row —
 * `0 4 3` / `. 0 4 1` / `. . 3 3` in ninths of coverage — while ours put a
 * single pixel per row at exactly rgb(194,128,128), DS_SELECTED_COLOR at full
 * alpha, with untouched background either side.
 *
 * There is no headless WebGL here, so what can be pinned is the shader pair's
 * own text: the guard on the solid branch, the varying that carries the flag,
 * and the ramp the off-axis case now falls through to. The ramp's arithmetic is
 * then driven from the expression parsed out of that text, so changing the
 * expression moves these numbers.
 */
import { describe, expect, it } from 'vitest';
import {
  SEGMENT_FRAG,
  SEGMENT_VERT,
  DISC_FRAG,
  DISC_VERT,
  GLYPH_FRAG,
  GLYPH_VERT,
  TRIANGLE_FRAG,
  TRIANGLE_VERT,
} from '@ziroeda/designer/src/render/gl/shaders.js';

describe('the solid-hairline branch', () => {
  it('is gated on the segment being axis-aligned', () => {
    // The whole fix: `&& v_axisAligned > 0.5`. Without it a diagonal takes the
    // solid branch and staircases.
    expect(SEGMENT_FRAG).toMatch(
      /if\s*\(\s*v_halfPx\s*<=\s*0\.51\s*&&\s*v_axisAligned\s*>\s*0\.5\s*\)/,
    );
  });

  it('is the only early return in the fragment stage', () => {
    // A second unguarded `return` would put the staircase back by another door.
    expect(SEGMENT_FRAG.match(/\breturn;/g)).toHaveLength(1);
  });
});

describe('the axis-aligned flag', () => {
  it('starts at zero, so an unhandled direction is off-axis', () => {
    expect(SEGMENT_VERT).toMatch(/float\s+axisAligned\s*=\s*0\.0\s*;/);
  });

  it('is raised exactly twice — once per snapping branch', () => {
    // Per-occurrence, not per-file: the horizontal branch and the vertical one
    // are the only two places the vertex stage calls a segment axis-aligned,
    // and they are the same two places it snaps. Raising it anywhere else, or
    // in only one of them, is a different rule from the one snapping uses.
    expect(SEGMENT_VERT.match(/axisAligned\s*=\s*1\.0\s*;/g)).toHaveLength(2);

    const horizontal = SEGMENT_VERT.indexOf('abs(along.y) < 0.001');
    const vertical = SEGMENT_VERT.indexOf('abs(along.x) < 0.001');
    const raises = [...SEGMENT_VERT.matchAll(/axisAligned\s*=\s*1\.0\s*;/g)].map((m) => m.index!);
    expect(horizontal).toBeGreaterThan(-1);
    expect(vertical).toBeGreaterThan(horizontal);
    expect(raises[0]).toBeGreaterThan(horizontal);
    expect(raises[0]).toBeLessThan(vertical);
    expect(raises[1]).toBeGreaterThan(vertical);
  });
});

/**
 * Every `flat in` a fragment stage reads has to be declared `flat out` by its
 * vertex stage, or the program fails to link and the canvas draws nothing.
 * Adding a varying to one half and forgetting the other is exactly the mistake
 * this file's change could have made, and no test here would otherwise see it.
 */
describe('varying declarations link', () => {
  const decls = (src: string, dir: 'in' | 'out'): string[] =>
    [...src.matchAll(new RegExp(`^\\s*(?:flat\\s+)?${dir}\\s+(\\w+)\\s+(\\w+)\\s*;`, 'gm'))].map(
      (m) => `${m[1]} ${m[2]}`,
    );

  const pairs: [string, string, string][] = [
    ['segment', SEGMENT_VERT, SEGMENT_FRAG],
    ['disc', DISC_VERT, DISC_FRAG],
    ['glyph', GLYPH_VERT, GLYPH_FRAG],
    ['triangle', TRIANGLE_VERT, TRIANGLE_FRAG],
  ];

  for (const [name, vert, frag] of pairs) {
    it(`${name}: the fragment stage reads nothing the vertex stage does not write`, () => {
      const written = new Set(decls(vert, 'out'));
      // `out vec4 fragColor` is the fragment output, not a varying.
      const read = decls(frag, 'in').filter((d) => d.startsWith('vec') || d.startsWith('float'));
      for (const v of read) expect(written).toContain(v);
      expect(read.length).toBeGreaterThan(0);
    });
  }
});

/**
 * What the off-axis case now does, driven by the expression in the shader.
 *
 * `cover` is parsed out of SEGMENT_FRAG rather than restated, so a change to
 * the ramp moves these numbers instead of leaving a stale copy passing.
 */
describe('the ramp an off-axis hairline falls through to', () => {
  const RAMP =
    /float\s+cover\s*=\s*clamp\(\s*v_halfPx\s*\+\s*0\.5\s*-\s*d\s*,\s*0\.0\s*,\s*1\.0\s*\)\s*;/;

  it('is the expression this test models', () => {
    expect(SEGMENT_FRAG).toMatch(RAMP);
  });

  /** A hairline: the vertex stage floors width to one pixel, so halfPx is 0.5. */
  const HALF_PX = 0.5;
  const cover = (d: number): number => Math.min(1, Math.max(0, HALF_PX + 0.5 - d));
  const solid = (d: number): number => (d <= 0.5 ? 1 : 0);

  /** Distance from a pixel centre to the segment, in device pixels. */
  const distToSeg = (px: number, py: number, a: number[], b: number[]): number => {
    const dx = b[0]! - a[0]!;
    const dy = b[1]! - a[1]!;
    const t = Math.max(
      0,
      Math.min(1, ((px - a[0]!) * dx + (py - a[1]!) * dy) / (dx * dx + dy * dy)),
    );
    return Math.hypot(px - (a[0]! + dx * t), py - (a[1]! + dy * t));
  };

  // The line in the two screenshots, in device pixels.
  const A = [694.5, 418.5];
  const B = [997.5, 824.5];

  const row = (rule: (d: number) => number, y: number): number[] =>
    Array.from({ length: 1200 }, (_, x) => rule(distToSeg(x + 0.5, y + 0.5, A, B))).filter(
      (a) => a > 0.02,
    );

  it('spreads each row over more than one pixel, the way SMAA does', () => {
    for (let y = 640; y < 660; y++) expect(row(cover, y).length).toBeGreaterThanOrEqual(2);
  });

  it('gives those pixels DIFFERENT alphas — the staircase gave them all one', () => {
    for (let y = 640; y < 660; y++) {
      const alphas = row(cover, y).map((a) => a.toFixed(3));
      expect(new Set(alphas).size).toBeGreaterThan(1);
      // What ours drew: every lit pixel at full strength, which is why the
      // measured screenshot had one colour and one only.
      expect(new Set(row(solid, y)).size).toBe(1);
    }
  });

  it('moves no ink: the ramp integrates to the solid band it replaces', () => {
    const step = 0.0005;
    let ramp = 0;
    let band = 0;
    for (let d = 0; d < 2; d += step) {
      ramp += cover(d) * step * 2; // both sides of the segment
      band += solid(d) * step * 2;
    }
    expect(ramp).toBeCloseTo(1, 2);
    expect(band).toBeCloseTo(1, 2);
  });
});
