// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * GerbView's scene is ordered, and its runs partition each buffer by layer.
 *
 * Node cannot see compositing - the board shipped with its layer order
 * inverted and 7264 tests passed - but it *can* see the order, because an
 * ordered Scene records runs. A run list that does not partition the buffers
 * contiguously, in layer order, cannot draw the right picture no matter what
 * the shaders do, so that is what is pinned here.
 *
 * Why it matters for gerbers specifically: layers carry their own colours and,
 * in forced-opacity mode, their own alpha. An unordered scene keeps order only
 * within each primitive kind, so every flashed pad (a disc) would draw after
 * every pour (triangles) regardless of which layer it is on.
 */
import { describe, expect, it } from 'vitest';
import type { Scene } from '@ziroeda/designer/src/render/gl/scene.js';
import {
  createGerberScene,
  layerMark,
  recordGerberScene,
  type GerberGlContent,
  type GerberGlLayer,
} from '@ziroeda/designer/src/render/gl/gerbview_gl.js';
import { parseGerber } from '@ziroeda/gerbview';

/** A layer with one flashed pad (a disc) and one trace (a segment). */
function image(clear = false): ReturnType<typeof parseGerber> {
  return parseGerber(
    [
      '%FSLAX46Y46*%',
      '%MOMM*%',
      '%ADD10C,0.5*%',
      clear ? '%LPC*%' : '%LPD*%',
      'D10*',
      'X0Y0D03*',
      'X1000000Y0D02*',
      'X2000000Y0D01*',
      'M02*',
    ].join('\n'),
    'l.gbr',
  );
}

const layer = (over: Partial<GerberGlLayer> = {}): GerberGlLayer => ({
  image: image(),
  color: 'rgb(200, 0, 0)',
  negativeColor: 'rgb(132, 132, 132)',
  highlightColor: 'rgb(255, 128, 128)',
  visible: true,
  ...over,
});

const content = (over: Partial<GerberGlContent> = {}): GerberGlContent => ({
  layers: [layer(), layer(), layer()],
  flashedSketch: false,
  linesSketch: false,
  polygonsSketch: false,
  showNegativeObjects: false,
  highlightTest: null,
  ...over,
});

/** Walk the runs and check each buffer is covered once, in order, with no gap. */
function partitions(scene: Scene): { ok: boolean; detail: string } {
  const next: Record<string, number> = { tri: 0, seg: 0, disc: 0, glyph: 0 };
  for (const run of scene.runs) {
    if (run.start !== next[run.kind]) {
      return {
        ok: false,
        detail: `${run.kind} run starts at ${run.start}, expected ${next[run.kind]}`,
      };
    }
    next[run.kind] = run.start + run.count;
  }
  const totals: Record<string, number> = {
    tri: scene.triangleVertexCount,
    seg: scene.segmentCount,
    disc: scene.discCount,
    glyph: scene.glyphVertexCount,
  };
  for (const k of Object.keys(totals)) {
    if (next[k] !== totals[k]) {
      return { ok: false, detail: `${k}: runs cover ${next[k]} of ${totals[k]}` };
    }
  }
  return { ok: true, detail: '' };
}

describe('gerbview scene recording', () => {
  it('records into an ordered scene', () => {
    // Through createGerberScene, which is what GerbviewGl uses: a test that
    // built its own `new Scene(true)` would pass whatever the renderer did,
    // and a mutant that unordered the real one survived exactly that way.
    const scene = createGerberScene();
    recordGerberScene(scene, content(), 1);
    // An unordered Scene records no runs at all, which is the failure this
    // guards: the picture would be right on one layer and wrong on three.
    expect(scene.runs.length).toBeGreaterThan(0);
  });

  it('records the same geometry whatever the view scale', () => {
    // The buffers hold world units, so a zoom must not move a vertex or change
    // a width. Widths are requested as `1 / scale` and the recorder turns that
    // into "at least one device pixel"; an absolute pen would bake the zoom
    // into the geometry and force a re-record on every zoom, which is the cost
    // this whole backend exists to remove.
    const c = content({ linesSketch: true, polygonsSketch: true, flashedSketch: true });
    const near = createGerberScene();
    const far = createGerberScene();
    recordGerberScene(near, c, 1);
    recordGerberScene(far, c, 8);
    expect(Array.from(far.segments.view())).toStrictEqual(Array.from(near.segments.view()));
    expect(Array.from(far.discs.view())).toStrictEqual(Array.from(near.discs.view()));
    expect(Array.from(far.triangles.view())).toStrictEqual(Array.from(near.triangles.view()));
  });

  it('has runs that partition every buffer contiguously', () => {
    const scene = createGerberScene();
    recordGerberScene(scene, content(), 1);
    const p = partitions(scene);
    expect(p.detail).toBe('');
    expect(p.ok).toBe(true);
  });

  it('marks one run boundary per visible layer, in draw order', () => {
    const scene = createGerberScene();
    recordGerberScene(scene, content(), 1);
    const marks = [0, 1, 2].map((i) => scene.marks.get(layerMark(i)));
    expect(marks.every((m) => m !== undefined)).toBe(true);
    // Strictly increasing: layer 1's geometry cannot begin before layer 0's.
    expect(marks[0]!).toBeLessThan(marks[1]!);
    expect(marks[1]!).toBeLessThan(marks[2]!);
  });

  it('skips a hidden layer entirely, and does not mark it', () => {
    const scene = createGerberScene();
    recordGerberScene(scene, content({ layers: [layer(), layer({ visible: false }), layer()] }), 1);
    expect(scene.marks.has(layerMark(0))).toBe(true);
    expect(scene.marks.has(layerMark(1))).toBe(false);
    expect(scene.marks.has(layerMark(2))).toBe(true);
    expect(partitions(scene).ok).toBe(true);
  });

  it('records nothing for a clear layer, as the OpenGL GAL draws nothing', () => {
    // OPENGL_GAL::SetNegativeDrawMode is `{}` and GetColor hands a clear item
    // COLOR4D( 0, 0, 0, 0 ), so an LPC layer contributes no ink on GerbView's
    // default canvas. Cairo erases; OpenGL does not.
    const scene = createGerberScene();
    recordGerberScene(scene, content({ layers: [layer({ image: image(true) })] }), 1);
    expect(scene.segmentCount).toBe(0);
    expect(scene.discCount).toBe(0);
    expect(scene.triangleVertexCount).toBe(0);
  });

  it('draws a clear layer as a ghost when show-negative-objects is on', () => {
    const scene = createGerberScene();
    recordGerberScene(
      scene,
      content({ layers: [layer({ image: image(true) })], showNegativeObjects: true }),
      1,
    );
    expect(scene.segmentCount + scene.discCount + scene.triangleVertexCount).toBeGreaterThan(0);
  });

  it('is view-independent: the same content records identically at any zoom', () => {
    // The scene holds world coordinates, so zooming must not change a vertex.
    // A view-dependent scene is what forces a re-record on every zoom, which
    // is the whole reason the 2D path cost 250 ms a frame.
    const a = createGerberScene();
    const b = createGerberScene();
    const c = content();
    recordGerberScene(a, c, 1);
    recordGerberScene(b, c, 1);
    expect(Array.from(b.segments.view())).toStrictEqual(Array.from(a.segments.view()));
    expect(Array.from(b.discs.view())).toStrictEqual(Array.from(a.discs.view()));
    expect(b.runs).toStrictEqual(a.runs);
  });
});
