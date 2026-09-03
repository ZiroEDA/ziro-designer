// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Bitmaps reach the GL scene.
 *
 * `GlRecorder.drawImage` was `{}` — a method that accepted the call and
 * recorded nothing. Three canvases then made the GL backend their default and
 * every image on a document stopped being drawn: the item was in the file, it
 * saved and reloaded, and the canvas showed nothing. The drawing sheet's image
 * tool was reported as "not working". It was working.
 *
 * That failure is invisible to every caller and to every test that does not
 * look at what was recorded, which is what these do. They cannot prove the
 * pixels are right — that needs a GPU and an eye — but they can prove the
 * geometry, the UVs and the texture identity arrive, and that is the half that
 * silently went missing.
 */
import { describe, expect, it } from 'vitest';
import { GlRecorder } from '@ziroeda/designer/src/render/gl/recorder.js';
import {
  IMAGE_VERTEX_STRIDE,
  IMAGE_VERTICES,
  type ImageSource,
  Scene,
} from '@ziroeda/designer/src/render/gl/scene.js';

/** Stands in for a decoded bitmap; only its identity is used before upload. */
const bitmap = (tag: string): ImageSource => ({ tag }) as unknown as ImageSource;

const verts = (scene: Scene): number[] => Array.from(scene.images.view());

describe('an image is recorded', () => {
  it('emits two triangles with the destination rect and full UVs', () => {
    const scene = new Scene(true);
    const rec = new GlRecorder(scene);

    rec.drawImage(bitmap('a'), 10, 20, 100, 50);

    expect(scene.imageVertexCount).toBe(IMAGE_VERTICES);
    const v = verts(scene);
    expect(v.length).toBe(IMAGE_VERTICES * IMAGE_VERTEX_STRIDE);

    // First vertex: the rect's origin at uv (0,0).
    expect(v.slice(0, 4)).toEqual([10, 20, 0, 0]);
    // Second: the far x edge, still the top, at uv (1,0).
    expect(v.slice(IMAGE_VERTEX_STRIDE, IMAGE_VERTEX_STRIDE + 4)).toEqual([110, 20, 1, 0]);
    // Last: the opposite corner at uv (1,1). If width and height were swapped
    // or the corners emitted in the wrong order, the image draws mirrored or
    // sheared, which is exactly the kind of thing that looks "nearly right".
    const last = v.slice((IMAGE_VERTICES - 1) * IMAGE_VERTEX_STRIDE);
    expect(last.slice(0, 4)).toEqual([110, 70, 1, 1]);
  });

  it('tints opaque white, so the bitmap is drawn as authored', () => {
    const scene = new Scene(true);
    new GlRecorder(scene).drawImage(bitmap('a'), 0, 0, 1, 1);
    expect(verts(scene).slice(4, 8)).toEqual([1, 1, 1, 1]);
  });

  it('carries the source through to the run, which is the texture key', () => {
    const scene = new Scene(true);
    const img = bitmap('a');
    new GlRecorder(scene).drawImage(img, 0, 0, 4, 4);

    const run = scene.runs.at(-1);
    expect(run?.kind).toBe('image');
    expect(run?.count).toBe(IMAGE_VERTICES);
    // Identity, not equality: the device caches one GPU texture per source
    // object, so a copy here would re-upload the bitmap every frame.
    expect(run?.image).toBe(img);
  });

  it('moves with the transform, so a bitmap follows the item carrying it', () => {
    const scene = new Scene(true);
    const rec = new GlRecorder(scene);
    rec.translate(1000, 2000);
    rec.drawImage(bitmap('a'), 10, 20, 30, 40);
    expect(verts(scene).slice(0, 2)).toEqual([1010, 2020]);
  });
});

describe('image runs never merge', () => {
  it('gives each bitmap a run of its own', () => {
    const scene = new Scene(true);
    const rec = new GlRecorder(scene);
    const a = bitmap('a');
    const b = bitmap('b');

    rec.drawImage(a, 0, 0, 10, 10);
    rec.drawImage(b, 20, 0, 10, 10);

    const runs = scene.runs.filter((r) => r.kind === 'image');
    // Two runs, not one of twelve vertices. Runs coalesce by kind, and a merged
    // run would draw BOTH quads with whichever texture was bound first - the
    // second image would appear as a copy of the first.
    expect(runs.length).toBe(2);
    expect(runs[0]?.image).toBe(a);
    expect(runs[1]?.image).toBe(b);
    expect(runs[0]?.count).toBe(IMAGE_VERTICES);
    expect(runs[1]?.count).toBe(IMAGE_VERTICES);
  });

  it('starts each run at its own offset into the buffer', () => {
    const scene = new Scene(true);
    const rec = new GlRecorder(scene);
    rec.drawImage(bitmap('a'), 0, 0, 10, 10);
    rec.drawImage(bitmap('b'), 0, 0, 10, 10);
    const runs = scene.runs.filter((r) => r.kind === 'image');
    expect(runs[0]?.start).toBe(0);
    expect(runs[1]?.start).toBe(IMAGE_VERTICES);
  });
});

describe('the scene accounts for images', () => {
  it('is not empty once one is recorded, and clears with the rest', () => {
    const scene = new Scene(true);
    // Without this the device can skip a scene that has an image and nothing
    // else — a sheet whose only content is a logo.
    expect(scene.isEmpty).toBe(true);
    new GlRecorder(scene).drawImage(bitmap('a'), 0, 0, 1, 1);
    expect(scene.isEmpty).toBe(false);

    scene.clear();
    expect(scene.imageVertexCount).toBe(0);
    expect(scene.isEmpty).toBe(true);
  });
});
