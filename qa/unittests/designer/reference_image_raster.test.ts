// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Painting a reference image.
 *
 * Two halves, and the interesting behaviour is all in the seam between them:
 * the scene records the payload and where it goes, and the cache holds the
 * decoded pixels. The scene has to be built synchronously and a PNG decode is
 * not, which is the whole reason they are separate.
 *
 * What is worth pinning is the cache's memory. It must remember a decode that
 * is *in flight* (or a board with one image starts a fresh decode every frame
 * until the first finishes) and it must remember a *failure* (or a corrupt
 * payload is retried forever). Both are invisible in a screenshot and obvious
 * in a profiler, which is exactly the kind of thing to hold with a test.
 */
import { describe, expect, it, vi } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { buildScene } from '@ziroeda/designer/src/editors/pcb/renderBoard.js';
import {
  ReferenceImageCache,
  base64ToBytes,
} from '@ziroeda/designer/src/editors/pcb/image_cache.js';
import type { Board, PcbImage } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

/** Records path ops instead of drawing, so a scene can be built under node. */
class RecordingPath2D {
  ops: Array<{ op: string; args: number[] }> = [];
  moveTo(...a: number[]): void {
    this.ops.push({ op: 'moveTo', args: a });
  }
  lineTo(...a: number[]): void {
    this.ops.push({ op: 'lineTo', args: a });
  }
  arc(...a: number[]): void {
    this.ops.push({ op: 'arc', args: a });
  }
  arcTo(...a: number[]): void {
    this.ops.push({ op: 'arcTo', args: a });
  }
  rect(...a: number[]): void {
    this.ops.push({ op: 'rect', args: a });
  }
  roundRect(...a: number[]): void {
    this.ops.push({ op: 'roundRect', args: a });
  }
  closePath(): void {
    this.ops.push({ op: 'closePath', args: [] });
  }
  addPath(other: RecordingPath2D): void {
    this.ops.push(...other.ops);
  }
}
(globalThis as unknown as { Path2D: unknown }).Path2D = RecordingPath2D;

/** A 1x1 PNG, so the header parser has real pixel dimensions to read. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const image = (over: Partial<PcbImage> = {}): PcbImage => ({
  at: { x: MM(10), y: MM(20) },
  layer: 'F.SilkS',
  data: PNG,
  source: EMPTY,
  ...over,
});

const board = (images: PcbImage[]): Board => ({
  version: 20240108,
  layers: [{ id: 0, name: 'F.Cu', kind: 'signal' }],
  nets: new Map([[0, '']]),
  footprints: [],
  tracks: [],
  arcs: [],
  vias: [],
  zones: [],
  shapes: [],
  texts: [],
  dimensions: [],
  textBoxes: [],
  tables: [],
  images,
  groups: [],
  source: EMPTY,
});

describe('the scene', () => {
  it('records the payload rather than trying to hold pixels', () => {
    const scene = buildScene(board([image()]));

    expect(scene.images).toHaveLength(1);
    expect(scene.images[0]?.data).toBe(PNG);
    expect(scene.images[0]?.layer).toBe('F.SilkS');
  });

  it('records where the picture goes, centred on its position', () => {
    // `(at …)` is the middle of a reference image, so the box straddles it.
    const box = buildScene(board([image()])).images[0]?.box;

    expect(box).toBeDefined();
    expect((box!.minX + box!.maxX) / 2).toBeCloseTo(MM(10), -3);
    expect((box!.minY + box!.maxY) / 2).toBeCloseTo(MM(20), -3);
  });

  it('grows the box with the scale', () => {
    const plain = buildScene(board([image()])).images[0]!.box;
    const doubled = buildScene(board([image({ scale: 2 })])).images[0]!.box;

    // Not exactly twice: the size is rounded once, after multiplying pixels by
    // the per-pixel IU and the scale together, so doubling the scale and
    // doubling the rounded answer can differ by an internal unit — a nanometre.
    expect(doubled.maxX - doubled.minX).toBeCloseTo(2 * (plain.maxX - plain.minX), -1);
    expect(doubled.maxX - doubled.minX).toBeGreaterThan(plain.maxX - plain.minX);
  });

  it('leaves the graphics strokes alone', () => {
    // An outline here would put a permanent box around every picture that does
    // decode; outlining is the paint pass's fallback, not the scene's job.
    const withImage = buildScene(board([image()]));
    const without = buildScene(board([]));

    expect(withImage.layers.get('F.SilkS')?.gfxStrokes.size ?? 0).toBe(0);
    expect(without.layers.get('F.SilkS')?.gfxStrokes.size ?? 0).toBe(0);
  });

  it('records each image separately, so two do not collapse into one', () => {
    const scene = buildScene(board([image(), image({ at: { x: MM(50), y: MM(50) } })]));

    expect(scene.images).toHaveLength(2);
  });
});

describe('base64ToBytes', () => {
  it('decodes to the PNG magic number', () => {
    expect([...base64ToBytes(PNG).slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('tolerates the line splits the file format puts in', () => {
    // The writer re-splits the payload at the MIME width of 76; a reader that
    // rejoins with newlines is within its rights, so they must not reach atob.
    const split = `${PNG.slice(0, 20)}\n${PNG.slice(20)}`;

    expect(base64ToBytes(split)).toEqual(base64ToBytes(PNG));
  });
});

describe('the cache', () => {
  const bitmap = { width: 1, height: 1 } as unknown as CanvasImageSource;

  it('knows nothing about a payload it has not been asked for', () => {
    expect(new ReferenceImageCache(async () => bitmap).get(PNG)).toBeUndefined();
  });

  it('publishes the bitmap and asks for a redraw once decoded', async () => {
    const onReady = vi.fn();
    const cache = new ReferenceImageCache(async () => bitmap);

    cache.ensure(PNG, onReady);
    await vi.waitFor(() => expect(onReady).toHaveBeenCalled());

    expect(cache.get(PNG)).toBe(bitmap);
  });

  it('decodes a payload once however many times it is asked', async () => {
    // Every frame calls ensure() for every image. Without the in-flight set,
    // one image on a slow decode starts a fresh decode per frame.
    const decode = vi.fn(async () => bitmap);
    const cache = new ReferenceImageCache(decode);

    cache.ensure(PNG, () => {});
    cache.ensure(PNG, () => {});
    await vi.waitFor(() => expect(cache.get(PNG)).toBe(bitmap));
    cache.ensure(PNG, () => {});

    expect(decode).toHaveBeenCalledTimes(1);
  });

  it('remembers a decode that fails, rather than retrying it forever', async () => {
    const decode = vi.fn(async () => {
      throw new Error('not a png');
    });
    const cache = new ReferenceImageCache(decode);

    cache.ensure(PNG, () => {});
    await vi.waitFor(() => expect(cache.get(PNG)).toBeNull());
    cache.ensure(PNG, () => {});

    expect(decode).toHaveBeenCalledTimes(1);
  });

  it('reports a failure too, since it changes what gets painted', async () => {
    const onReady = vi.fn();
    const cache = new ReferenceImageCache(async () => {
      throw new Error('nope');
    });

    cache.ensure(PNG, onReady);

    await vi.waitFor(() => expect(onReady).toHaveBeenCalled());
  });

  it('records a payload that is not even base64 as a failure', async () => {
    const decode = vi.fn(async () => bitmap);
    const cache = new ReferenceImageCache(decode);
    const onReady = vi.fn();

    cache.ensure('!!!not base64!!!', onReady);

    expect(cache.get('!!!not base64!!!')).toBeNull();
    expect(onReady).toHaveBeenCalled();
    expect(decode).not.toHaveBeenCalled();
  });

  it('keeps two different payloads apart', async () => {
    const other = { width: 2, height: 2 } as unknown as CanvasImageSource;
    const cache = new ReferenceImageCache(async (bytes) => (bytes.length > 60 ? bitmap : other));

    cache.ensure(PNG, () => {});
    cache.ensure('AAAA', () => {});
    await vi.waitFor(() => {
      expect(cache.get(PNG)).toBe(bitmap);
      expect(cache.get('AAAA')).toBe(other);
    });
  });
});
