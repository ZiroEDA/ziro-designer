// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The real schematic renderer, driven through the WebGL recorder (#449).
 *
 * `gl_recorder.test.ts` checks the recorder against drawing calls written by
 * hand. This checks it against the only caller that matters: three thousand
 * lines of `renderer.ts` on an actual KiCad document, which exercises symbols,
 * pins, wires, labels, sheet symbols, fills and several thousand stroke-font
 * glyph runs in one pass.
 *
 * Two things are asserted, and the second is the load-bearing one.
 *
 * **It records something substantial.** A recorder that quietly dropped every
 * call would satisfy any invariant perfectly, so the counts are checked first.
 *
 * **The bytes do not depend on the zoom.** This is the property the entire
 * WebGL backend is built on: if recorded geometry varies with the view, the
 * buffer has to be rebuilt on every zoom step, and rebuilding is the ~70 ms
 * repaint we are replacing. Then the backend would be no faster than the
 * Canvas2D one and a good deal more complicated.
 *
 * It is not obviously true, either. `renderer.ts` consults the view scale in
 * four places, and each one had to be turned into something the shader
 * re-derives per frame rather than something baked into a vertex.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import {
  renderSchematic,
  setVectorText,
  DEFAULT_RENDER_OPTS,
} from '@ziroeda/designer/src/editors/schematic/render/renderer.js';
import { GlRecorder } from '@ziroeda/designer/src/render/gl/recorder.js';
import { Scene } from '@ziroeda/designer/src/render/gl/scene.js';
import type { Theme } from '@ziroeda/designer/src/editors/schematic/theme.js';

const SRC = readFileSync(
  join(import.meta.dirname, '../../data/complex_hierarchy.kicad_sch'),
  'utf8',
);

/** Every colour the renderer asks for; only the background needs to differ. */
const theme = new Proxy(
  {},
  { get: (_t, k) => (k === 'background' ? '#f0f0f0' : '#008484') },
) as unknown as Theme;

/**
 * Record the whole document at a given reference scale.
 *
 * The canvas is enormous and the view scale is 1, so `renderer.ts`'s own
 * viewport culling keeps everything: a retained buffer has to hold the whole
 * document, and the GPU does the culling afterwards for free.
 *
 * `referenceScale` is the only thing that varies between calls. It is what the
 * caller's `1 / scale` hairline requests were computed against, so if any zoom
 * dependence survives into the geometry, this is what will expose it.
 */
function record(referenceScale: number): Scene {
  const scene = new Scene();
  const rec = new GlRecorder(scene, { referenceScale, devicePixelRatio: 1 });
  // Stroke text as raw segments rather than through a cached Path2D, the same
  // mode the SVG plotter uses. Path2D is a browser type and carries no readable
  // geometry, so a recording backend cannot see inside one.
  setVectorText(true);
  try {
    const BIG = 1e9;
    renderSchematic(
      // The same cast `plot.ts` uses for its SVG, DXF and PostScript backends.
      // `renderSchematic` declares the full `CanvasRenderingContext2D`, but
      // touches 26 of its members; this backend is the fourth to supply those
      // 26 and nothing else.
      rec as unknown as CanvasRenderingContext2D,
      readSchematic(parse(SRC)),
      { scale: 1, offsetX: BIG / 2, offsetY: BIG / 2 },
      theme,
      BIG,
      BIG,
      undefined,
      undefined,
      // The grid is left out on purpose. It is regular, cheap, and genuinely
      // zoom-dependent (the spacing adapts), so it does not belong in a buffer
      // whose whole value is not being rebuilt. It gets its own pass.
      { ...DEFAULT_RENDER_OPTS, grid: { ...DEFAULT_RENDER_OPTS.grid, show: false } },
    );
  } finally {
    setVectorText(false);
  }
  return scene;
}

describe('recording a real schematic', () => {
  it('produces a substantial scene', () => {
    // A recorder that dropped everything would pass the invariant below.
    const s = record(0.00002);
    expect(s.segmentCount).toBeGreaterThan(1000);
    expect(s.isEmpty).toBe(false);
  });

  it('stays small enough to keep resident', () => {
    // The point of uploading once is that it can stay uploaded.
    const s = record(0.00002);
    const floats = s.segments.length + s.discs.length + s.triangles.length;
    expect(floats * 4).toBeLessThan(32 * 1024 * 1024);
  });
});

describe('the recorded geometry does not depend on the zoom', () => {
  it('is byte-identical across a 4x change of view scale', () => {
    // If this fails, the buffer must be rebuilt on every zoom step and the
    // WebGL backend has lost its reason to exist. Compared float by float
    // rather than by count: a count can match while every coordinate has
    // shifted.
    const a = record(0.00002);
    const b = record(0.00008);

    expect(b.segmentCount).toBe(a.segmentCount);
    expect(b.discCount).toBe(a.discCount);
    expect(b.triangleVertexCount).toBe(a.triangleVertexCount);

    const va = a.segments.view();
    const vb = b.segments.view();
    let differing = 0;
    for (let i = 0; i < va.length; i++) if (va[i] !== vb[i]) differing++;
    expect(differing, `${differing} of ${va.length} segment floats moved with the view`).toBe(0);

    const ta = a.triangles.view();
    const tb = b.triangles.view();
    let triDiff = 0;
    for (let i = 0; i < ta.length; i++) if (ta[i] !== tb[i]) triDiff++;
    expect(triDiff).toBe(0);
  });

  it('records hairlines as a pixel floor rather than a world width', () => {
    // The mechanism that makes the above true: a `1 / scale` request becomes
    // "at least N device pixels", which the shader applies per frame, instead
    // of a world width that would grow as you zoom in.
    const s = record(0.00002);
    const v = s.segments.view();
    let pixelFloored = 0;
    for (let i = 0; i < v.length; i += 10) if (v[i + 4] === 0 && v[i + 5]! > 0) pixelFloored++;
    expect(pixelFloored).toBeGreaterThan(0);
  });
});
