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
 * It runs the *production* recorder, `recordSchematicScene`, rather than a
 * copy of its setup. An earlier version of this file built its own recorder,
 * which meant it checked the recorder and not the way the recorder is called,
 * and the way it was called is where the bug was: recording at a nominal scale
 * of 1 made every selection halo and field umbilical two internal units wide,
 * a five-hundredth of a millimetre. They were drawn perfectly and were
 * invisible, and every test passed, because no test recorded with a selection.
 *
 * Three things are asserted:
 *
 * **It records something substantial.** A recorder that dropped every call
 * would satisfy any invariant perfectly, so the counts are checked first.
 *
 * **The scale-derived decorations are visible.** The regression above.
 *
 * **How far the geometry depends on the zoom**, stated honestly rather than
 * assumed away: it is deterministic at a fixed scale, and it *does* change
 * across scales because of the text level of detail. That is what the zoom
 * bucket in `SchematicGl` exists to bound.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, refId } from '@ziroeda/eeschema';
import { DEFAULT_RENDER_OPTS } from '@ziroeda/designer/src/editors/schematic/render/renderer.js';
import { recordSchematicScene } from '@ziroeda/designer/src/render/gl/schematic_gl.js';
import { Scene } from '@ziroeda/designer/src/render/gl/scene.js';
import type { Theme } from '@ziroeda/designer/src/editors/schematic/theme.js';

/** A realistic view scale for this sheet: about 20 nm per device pixel. */
const SCALE = 0.00002;

const SRC = readFileSync(
  join(import.meta.dirname, '../../data/complex_hierarchy.kicad_sch'),
  'utf8',
);

/** Every colour the renderer asks for; only the background needs to differ. */
const theme = new Proxy(
  {},
  { get: (_t, k) => (k === 'background' ? '#f0f0f0' : '#008484') },
) as unknown as Theme;

/** Record the whole document as it should look at `scale`. */
function record(scale: number, selection?: ReadonlySet<string>): Scene {
  const scene = new Scene();
  recordSchematicScene(
    scene,
    {
      doc: readSchematic(parse(SRC)),
      theme,
      opts: DEFAULT_RENDER_OPTS,
      selection,
      highlight: selection,
    },
    scale,
  );
  return scene;
}

describe('recording a real schematic', () => {
  it('produces a substantial scene', () => {
    // A recorder that dropped everything would pass the invariant below.
    const s = record(SCALE);
    expect(s.segmentCount).toBeGreaterThan(1000);
    expect(s.isEmpty).toBe(false);
  });

  it('stays small enough to keep resident', () => {
    // The point of uploading once is that it can stay uploaded.
    const s = record(SCALE);
    const floats = s.segments.length + s.discs.length + s.triangles.length;
    expect(floats * 4).toBeLessThan(32 * 1024 * 1024);
  });
});

describe('how far the recorded geometry depends on the zoom', () => {
  it('is byte-identical when re-recorded at the same scale', () => {
    // Determinism, and the floor under everything else: a buffer is reused
    // across many frames, so the same inputs must give the same bytes.
    // Compared float by float rather than by count, since a count can match
    // while every coordinate has shifted.
    const a = record(SCALE);
    const b = record(SCALE);

    expect(b.segmentCount).toBe(a.segmentCount);
    const va = a.segments.view();
    const vb = b.segments.view();
    let differing = 0;
    for (let i = 0; i < va.length; i++) if (va[i] !== vb[i]) differing++;
    expect(differing).toBe(0);
  });

  it('does depend on the zoom, through the text level of detail', () => {
    // Stated as a fact rather than hidden, because an earlier version of this
    // file recorded at scale 1 for both sides and so proved nothing: with the
    // scale held fixed, of course nothing moved.
    //
    // Two things genuinely vary with the view scale.
    //
    //   1. `drawText` skips a run under 0.6 screen pixels, so a different zoom
    //      records a different amount of text. This is the big one, and it is
    //      why the counts below differ by nearly threefold.
    //   2. Selection decorations: the halo width and a selected field's anchor
    //      cross radius are computed from the scale.
    //
    // `SchematicGl` handles both by keying the buffer on the zoom *octave*, so
    // a wheel gesture stays inside one bucket and a re-record happens only when
    // the zoom has doubled or halved. Removing the dependence entirely means
    // moving the text cull into the shader, which is worth doing and is not
    // done yet.
    //
    // If this test ever starts passing, that work has landed: replace it with
    // the byte-identical assertion across scales.
    const a = record(SCALE);
    const b = record(SCALE * 4);
    expect(b.segmentCount).not.toBe(a.segmentCount);
    expect(b.segmentCount).toBeGreaterThan(a.segmentCount);
  });

  it('draws a selection halo wide enough to see', () => {
    // The bug this exists for. `renderer.ts` sizes the halo as
    // `highlightThickness / scale + highlightThickness * MIL`, and a field's
    // umbilical as `max(1, 1 / scale)`. Recording at scale 1 collapsed both to
    // one or two internal units. A millimetre is a million of them, so they
    // were drawn correctly and were invisible, and every test still passed
    // because none of them recorded with a selection.
    const doc = readSchematic(parse(SRC));
    const selected = new Set(doc.lines.map((l, i) => refId('line', l.uuid, i)).slice(0, 5));
    expect(selected.size).toBeGreaterThan(0);

    const plain = record(SCALE);
    const withHalo = record(SCALE, selected);
    expect(withHalo.segmentCount).toBeGreaterThan(plain.segmentCount);

    // The halo is the widest thing on the sheet by some way. Measured in world
    // units, it has to be a real fraction of a millimetre, not a rounding error.
    const v = withHalo.segments.view();
    let widest = 0;
    for (let i = 0; i < v.length; i += 10) widest = Math.max(widest, v[i + 4]!);
    const MM = 1e6;
    expect(widest, 'widest recorded stroke, in internal units').toBeGreaterThan(0.05 * MM);
  });

  it('records hairlines as a pixel floor rather than a world width', () => {
    // The mechanism that makes the above true: a `1 / scale` request becomes
    // "at least N device pixels", which the shader applies per frame, instead
    // of a world width that would grow as you zoom in.
    const s = record(SCALE);
    const v = s.segments.view();
    let pixelFloored = 0;
    for (let i = 0; i < v.length; i += 10) if (v[i + 4] === 0 && v[i + 5]! > 0) pixelFloored++;
    expect(pixelFloored).toBeGreaterThan(0);
  });
});
