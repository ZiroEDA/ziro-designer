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
 * **The scale-derived decorations are visible.** The regression above — now
 * measured on the pass that actually draws them. Halos are no longer recorded
 * into the buffer at all: their width is a fixed number of *screen* pixels
 * (`SCH_PAINTER::getShadowWidth`), so one baked into a buffer that is never
 * re-recorded on a zoom is the right width at exactly one zoom level and a fat
 * bar at every closer one. The 2D layer under the GL one draws them per frame.
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

  it('is byte-identical across a 4x change of view scale', () => {
    // The property the whole backend rests on, and it now actually holds.
    //
    // It did not before. The recorder classified each width against the
    // recording scale and stored a scale-derived pixel floor, so 98% of
    // segments differed between one zoom octave and the next and the buffer had
    // to be rebuilt whenever the zoom crossed one, at 50 to 100 ms a time.
    // A minimum width belongs to the view, not to a vertex; the shader clamps
    // it, and the geometry stopped caring about the zoom.
    //
    // Compared float by float rather than by count: a count can match while
    // every coordinate has shifted.
    const a = record(SCALE);
    const b = record(SCALE * 4);

    expect(b.segmentCount).toBe(a.segmentCount);
    expect(b.discCount).toBe(a.discCount);
    expect(b.triangleVertexCount).toBe(a.triangleVertexCount);

    const va = a.segments.view();
    const vb = b.segments.view();
    let differing = 0;
    for (let i = 0; i < va.length; i++) if (va[i] !== vb[i]) differing++;
    expect(differing, `${differing} of ${va.length} segment floats moved with the view`).toBe(0);
  });

  it('leaves the selection halo out of the buffer entirely', () => {
    // A halo's width is `getShadowWidth`: a fixed number of *screen pixels*
    // plus a small world width. That is the one piece of a sheet whose
    // geometry genuinely depends on the zoom, and the buffer above is
    // deliberately never re-recorded on a zoom — so a halo recorded into it
    // keeps the width it had when it was recorded. A three-pixel glow at
    // fit-to-page became a twenty-pixel bar once you zoomed in on a part, which
    // is the "the halo swallows the geometry" report.
    //
    // `recordSchematicScene` therefore records with `halos: 'skip'`, and the 2D
    // layer underneath draws them per frame at the live scale. A selection
    // must now change nothing at all in here.
    const doc = readSchematic(parse(SRC));
    const selected = new Set(doc.lines.map((l, i) => refId('line', l.uuid, i)).slice(0, 5));
    expect(selected.size).toBeGreaterThan(0);

    const plain = record(SCALE);
    const withSelection = record(SCALE, selected);
    expect(withSelection.segmentCount).toBe(plain.segmentCount);

    const va = plain.segments.view();
    const vb = withSelection.segments.view();
    let differing = 0;
    for (let i = 0; i < va.length; i++) if (va[i] !== vb[i]) differing++;
    expect(differing, 'segment floats a selection changed').toBe(0);
  });

  it('but the halo pass draws one, and sizes it against the live view', () => {
    // The other half, and the regression the removed test guarded: the halo has
    // to be *visible*. Recording at a nominal scale of 1 once made every halo
    // two internal units wide — a five-hundredth of a millimetre — drawn
    // perfectly and invisible, with every test passing because none of them
    // recorded with a selection.
    //
    // Now it is measured where it is actually drawn. Its width is
    // `mils / scale + mils * MIL`, so halving the scale must roughly double it:
    // that is what makes it a constant number of screen pixels at every zoom.
    const doc = readSchematic(parse(SRC));
    const selected = new Set(doc.lines.map((l, i) => refId('line', l.uuid, i)).slice(0, 5));

    const widest = (scale: number): number => {
      const scene = new Scene();
      recordSchematicScene(
        scene,
        {
          doc,
          theme,
          opts: { ...DEFAULT_RENDER_OPTS, halos: 'only' },
          selection: selected,
          highlight: undefined,
        },
        scale,
      );
      const v = scene.segments.view();
      let w = 0;
      for (let i = 0; i < v.length; i += 10) w = Math.max(w, v[i + 4]!);
      return w;
    };

    const MM = 1e6;
    const atScale = widest(SCALE);
    expect(atScale, 'widest halo stroke, in internal units').toBeGreaterThan(0.05 * MM);
    // Zoomed out twice as far, the same halo is twice as wide in world units.
    const zoomedOut = widest(SCALE / 2);
    expect(zoomedOut / atScale).toBeGreaterThan(1.8);
    expect(zoomedOut / atScale).toBeLessThan(2.2);
  });

  it('gives every segment the same constant pixel floor', () => {
    // The mechanism that makes the invariant above hold. A minimum width is one
    // decision about the view, not a per-vertex value, so it is the same number
    // on every segment and the shader applies it. When it was computed per
    // segment against the recording scale it differed on 98% of them between
    // one octave and the next, and that alone forced a rebuild on every zoom.
    const v = record(SCALE).segments.view();
    const floors = new Set<number>();
    for (let i = 0; i < v.length; i += 10) floors.add(v[i + 5]!);
    expect(floors.size).toBe(1);
    expect([...floors][0]).toBeGreaterThan(0);
  });

  it('stores real world widths, not zeroes standing in for a pixel request', () => {
    // The other half: widths are the world widths the renderer asked for, so
    // they mean the same thing at every zoom.
    const v = record(SCALE).segments.view();
    let withWidth = 0;
    for (let i = 0; i < v.length; i += 10) if (v[i + 4]! > 0) withWidth++;
    expect(withWidth).toBeGreaterThan(0);
  });
});
