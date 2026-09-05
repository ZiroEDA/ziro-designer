// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Reference Image Properties dialog.
 * Counterparts: `DIALOG_REFERENCE_IMAGE_PROPERTIES` and the scale half of
 * `PANEL_IMAGE_EDITOR`.
 *
 * The dialog shows width, height and scale, but the item stores only a scale —
 * so all three are one number wearing three hats, and typing in any of them has
 * to move the other two. That three-way binding is what most of this file is
 * about; the rest is the usual round-trip contract, where a scale of exactly 1
 * has to go back to being *absent* rather than written out.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { parse } from '@ziroeda/sexpr/src/index.js';
import {
  applyImageValues,
  collectImageValues,
  imageAt,
  scaleForHeight,
  scaleForWidth,
  sizeForScale,
} from '@ziroeda/pcbnew/src/image_properties.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import type { Board, PcbImage } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

/** A 1x1 PNG: real header, so the pixel size and PPI are read rather than faked. */
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
  points: [],
  barcodes: [],
  groups: [],
  source: EMPTY,
});

describe('which image the dialog edits', () => {
  it('is the one selected image', () => {
    expect(imageAt(board([image(), image()]), ['image:1'])).toBe(1);
  });

  it('is nothing when two are selected', () => {
    expect(imageAt(board([image(), image()]), ['image:0', 'image:1'])).toBeNull();
  });

  it('is nothing when the selection is another kind of item', () => {
    expect(imageAt(board([image()]), ['textbox:0'])).toBeNull();
  });

  it('is nothing when the index is past the end', () => {
    expect(imageAt(board([image()]), ['image:7'])).toBeNull();
  });
});

describe('reading the item into the dialog', () => {
  it('reports an absent scale as 1, which is what the file means by it', () => {
    expect(collectImageValues(image()).scale).toBe(1);
  });

  it('reports the position and layer as they are', () => {
    const v = collectImageValues(image());

    expect(v.x).toBe(MM(10));
    expect(v.y).toBe(MM(20));
    expect(v.layer).toBe('F.SilkS');
    expect(v.locked).toBe(false);
  });

  it('derives width and height from the scale', () => {
    const plain = collectImageValues(image());
    const doubled = collectImageValues(image({ scale: 2 }));

    expect(doubled.width).toBeGreaterThan(plain.width);
    expect(doubled.height).toBeGreaterThan(plain.height);
  });
});

describe('the three-way binding', () => {
  const img = image();
  const start = collectImageValues(img);

  it('turns a typed width into a scale', () => {
    const next = scaleForWidth(img, start, start.width * 3);

    expect(next.scale).toBeCloseTo(3, 6);
  });

  it('moves the height when the width is typed, since one scale drives both', () => {
    // There is no independent stretch: the aspect ratio is a property of the
    // model, which holds a single scale factor.
    const next = scaleForWidth(img, start, start.width * 3);

    expect(next.height).toBeGreaterThan(start.height);
    expect(next.height / next.width).toBeCloseTo(start.height / start.width, 3);
  });

  it('turns a typed height into a scale the same way', () => {
    const next = scaleForHeight(img, start, start.height * 3);

    expect(next.scale).toBeCloseTo(3, 6);
    expect(next.width).toBeGreaterThan(start.width);
  });

  it('drives both sizes from a typed scale', () => {
    const next = sizeForScale(img, start, 4);

    expect(next.width).toBe(collectImageValues(image({ scale: 4 })).width);
    expect(next.height).toBe(collectImageValues(image({ scale: 4 })).height);
  });

  it('round-trips: a width typed in comes back out', () => {
    const target = start.width * 5;

    expect(scaleForWidth(img, start, target).width).toBeCloseTo(target, -2);
  });

  it('ignores a width of zero rather than collapsing the image', () => {
    // What you see mid-typing, right after clearing the field.
    expect(scaleForWidth(img, start, 0)).toBe(start);
    expect(scaleForWidth(img, start, -5)).toBe(start);
  });

  it('ignores a height of zero for the same reason', () => {
    expect(scaleForHeight(img, start, 0)).toBe(start);
  });

  it('ignores a scale of zero or less', () => {
    expect(sizeForScale(img, start, 0)).toBe(start);
    expect(sizeForScale(img, start, -1)).toBe(start);
  });

  it('refuses to divide by an image that measures nothing', () => {
    // A hand-edited file can say `(scale 0)`. Then the current size is zero
    // across, and computing a scale from a typed width divides by it — giving
    // an infinite scale that the guard on `sizeForScale` would happily accept,
    // since infinity is greater than zero.
    const flat = image({ scale: 0 });
    const flatStart = collectImageValues(flat);

    expect(scaleForWidth(flat, flatStart, MM(10))).toBe(flatStart);
    expect(scaleForHeight(flat, flatStart, MM(10))).toBe(flatStart);
  });

  it('composes: scale then width then scale lands where the last one says', () => {
    // The reason this is one pure function rather than three event handlers —
    // upstream needs ChangeDoubleValue to stop the fields chasing each other.
    const a = sizeForScale(img, start, 2);
    const b = scaleForWidth(img, a, a.width * 2);
    const c = sizeForScale(img, b, 7);

    expect(b.scale).toBeCloseTo(4, 6);
    expect(c.scale).toBe(7);
    expect(c.width).toBe(collectImageValues(image({ scale: 7 })).width);
  });
});

describe('writing the dialog back', () => {
  it('does nothing at all when nothing changed', () => {
    const b = board([image()]);

    expect(applyImageValues(b, 0, collectImageValues(b.images[0]!))).toBe(b);
  });

  it('moves the image', () => {
    const b = board([image()]);
    const v = { ...collectImageValues(b.images[0]!), x: MM(55), y: MM(66) };

    expect(applyImageValues(b, 0, v).images[0]?.at).toEqual({ x: MM(55), y: MM(66) });
  });

  it('changes the layer and the lock', () => {
    const b = board([image()]);
    const v = { ...collectImageValues(b.images[0]!), layer: 'B.SilkS', locked: true };
    const after = applyImageValues(b, 0, v).images[0];

    expect(after?.layer).toBe('B.SilkS');
    expect(after?.locked).toBe(true);
  });

  it('stores a scale that is not 1', () => {
    const b = board([image()]);
    const v = { ...collectImageValues(b.images[0]!), scale: 2.5 };

    expect(applyImageValues(b, 0, v).images[0]?.scale).toBe(2.5);
  });

  it('drops a scale of exactly 1 back to absent', () => {
    // The file omits a scale of 1, so keeping the number would make an
    // untouched image grow a token the next time it is saved.
    const b = board([image({ scale: 3 })]);
    const v = { ...collectImageValues(b.images[0]!), scale: 1 };

    expect(applyImageValues(b, 0, v).images[0]?.scale).toBeUndefined();
  });

  it('leaves the other images alone', () => {
    const b = board([image(), image({ at: { x: MM(99), y: MM(99) } })]);
    const v = { ...collectImageValues(b.images[0]!), x: MM(1) };

    expect(applyImageValues(b, 0, v).images[1]).toBe(b.images[1]);
  });

  it('does not disturb the board’s other item arrays', () => {
    const b = board([image()]);
    const v = { ...collectImageValues(b.images[0]!), x: MM(1) };
    const after = applyImageValues(b, 0, v);

    expect(after.shapes).toBe(b.shapes);
    expect(after.textBoxes).toBe(b.textBoxes);
  });
});

describe('through a real file', () => {
  const FILE = `(kicad_pcb (version 20240108) (generator "test")
  (image (at 10 20) (layer "F.SilkS") (scale 3) (uuid "aaa")
    (data "${PNG}")
  )
)`;

  it('keeps everything it does not edit', () => {
    const b = readBoard(parse(FILE) as never);
    const v = { ...collectImageValues(b.images[0]!), x: MM(30) };
    const out = serializeBoard(applyImageValues(b, 0, v));

    expect(out).toContain('(at 30 20)');
    expect(out).toContain('(uuid "aaa")');
    expect(out).toContain(PNG.slice(0, 20));
  });

  it('removes the scale token when the scale goes back to 1', () => {
    const b = readBoard(parse(FILE) as never);
    const v = { ...collectImageValues(b.images[0]!), scale: 1 };
    const out = serializeBoard(applyImageValues(b, 0, v));

    expect(out).not.toContain('(scale');
  });

  it('adds a locked token only once locked, and removes it again', () => {
    const b = readBoard(parse(FILE) as never);
    const base = collectImageValues(b.images[0]!);

    const locked = serializeBoard(applyImageValues(b, 0, { ...base, locked: true }));
    expect(locked).toContain('(locked yes)');

    const relocked = readBoard(parse(locked) as never);
    const unlocked = serializeBoard(
      applyImageValues(relocked, 0, { ...collectImageValues(relocked.images[0]!), locked: false }),
    );
    expect(unlocked).not.toContain('(locked');
  });

  it('leaves an untouched file byte-identical', () => {
    const b = readBoard(parse(FILE) as never);

    expect(serializeBoard(applyImageValues(b, 0, collectImageValues(b.images[0]!)))).toBe(
      serializeBoard(b),
    );
  });
});
