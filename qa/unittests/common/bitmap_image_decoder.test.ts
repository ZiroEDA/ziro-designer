// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Ours: `BITMAP_IMAGE_DECODER`, the browser decoder for what `WX_IMAGE` reads for its size
 * only (a JPEG), and `GL_BITMAP_CACHE` uploading what it decodes. The decoder is injected: the
 * pixels are the browser's, what is pinned here is when they are asked for, how often, and what
 * the cache does while it waits.
 */
import { describe, expect, it } from 'vitest';
import { BITMAP_BASE } from '@ziroeda/common/bitmap_base.js';
import { BITMAP_IMAGE_DECODER } from '@ziroeda/common/draw_panel_gal.js';
import { wxBitmapType } from '@ziroeda/wx/wx_image.js';

/** The smallest stream `WX_IMAGE` takes for a JPEG: SOI and a baseline SOF0 frame header. */
function jpegBytes(aWidth: number, aHeight: number): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8, // SOI
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08, // SOF0, length 17, 8 bits per sample
    aHeight >> 8,
    aHeight & 0xff,
    aWidth >> 8,
    aWidth & 0xff,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
    0xff,
    0xd9, // EOI
  ]);
}

function jpegBitmap(aWidth = 4, aHeight = 3): BITMAP_BASE {
  const bitmap = new BITMAP_BASE();
  expect(bitmap.ReadImageFile(jpegBytes(aWidth, aHeight))).toBe(true);
  return bitmap;
}

/** A stand-in ImageBitmap that records being closed. */
function fakeBitmap(): ImageBitmap & { closed: boolean } {
  const b = { width: 4, height: 3, closed: false, close: () => (b.closed = true) };
  return b as unknown as ImageBitmap & { closed: boolean };
}

/** A decode whose promise the test settles. */
function deferredDecode() {
  const calls: { blob: Blob; resolve: (b: ImageBitmap) => void; reject: () => void }[] = [];
  const decode = (blob: Blob) =>
    new Promise<ImageBitmap>((resolve, reject) => calls.push({ blob, resolve, reject }));
  return { calls, decode };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('WX_IMAGE and a JPEG', () => {
  it('reads the size, keeps the bytes, and decodes no pixels - the gap this closes', () => {
    const bitmap = jpegBitmap(4, 3);

    expect(bitmap.GetImageType()).toBe(wxBitmapType.wxBITMAP_TYPE_JPEG);
    expect(bitmap.GetSizePixels()).toEqual({ x: 4, y: 3 });
    expect(bitmap.GetOriginalImageData()!.GetData()).toBeNull();
    expect(bitmap.SaveImageData()).toEqual(jpegBytes(4, 3));
  });
});

describe('BITMAP_IMAGE_DECODER', () => {
  it('answers null, decodes the bytes as read as image/jpeg, then hands back the bitmap', async () => {
    const { calls, decode } = deferredDecode();
    let repaints = 0;
    const decoder = new BITMAP_IMAGE_DECODER(() => repaints++, decode);
    const bitmap = jpegBitmap();

    expect(decoder.Get(bitmap)).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.blob.type).toBe('image/jpeg');
    expect(new Uint8Array(await calls[0]!.blob.arrayBuffer())).toEqual(jpegBytes(4, 3));
    expect(repaints).toBe(0);

    const pixels = fakeBitmap();
    calls[0]!.resolve(pixels);
    await settle();

    expect(repaints).toBe(1);
    expect(decoder.Get(bitmap)).toBe(pixels);
  });

  it('decodes once per image: not again while in flight, nor for a copy that shares its id', async () => {
    const { calls, decode } = deferredDecode();
    const decoder = new BITMAP_IMAGE_DECODER(() => {}, decode);
    const bitmap = jpegBitmap();
    const copy = new BITMAP_BASE(bitmap);

    expect(copy.GetImageID()).toBe(bitmap.GetImageID());

    decoder.Get(bitmap);
    decoder.Get(bitmap);
    decoder.Get(copy);
    expect(calls).toHaveLength(1);

    const pixels = fakeBitmap();
    calls[0]!.resolve(pixels);
    await settle();

    expect(decoder.Get(copy)).toBe(pixels);
    expect(calls).toHaveLength(1);
  });

  it('remembers a failed decode, so a corrupt image is not retried every frame', async () => {
    const { calls, decode } = deferredDecode();
    let repaints = 0;
    const decoder = new BITMAP_IMAGE_DECODER(() => repaints++, decode);
    const bitmap = jpegBitmap();

    decoder.Get(bitmap);
    calls[0]!.reject();
    await settle();

    expect(decoder.Get(bitmap)).toBeNull();
    expect(decoder.Get(bitmap)).toBeNull();
    expect(calls).toHaveLength(1);
    expect(repaints).toBe(0);
  });

  it('without a decoder (no createImageBitmap) answers null and does not retry', () => {
    const decoder = new BITMAP_IMAGE_DECODER(() => {}, null);
    const bitmap = jpegBitmap();

    expect(decoder.Get(bitmap)).toBeNull();
    expect(decoder.Get(bitmap)).toBeNull();
  });

  it('Destroy closes what it decoded, and a decode landing afterwards is closed unrepainted', async () => {
    const { calls, decode } = deferredDecode();
    let repaints = 0;
    const decoder = new BITMAP_IMAGE_DECODER(() => repaints++, decode);
    const first = jpegBitmap();
    const second = jpegBitmap();

    decoder.Get(first);
    const firstPixels = fakeBitmap();
    calls[0]!.resolve(firstPixels);
    await settle();
    expect(repaints).toBe(1);

    decoder.Get(second);
    decoder.Destroy();
    expect(firstPixels.closed).toBe(true);

    const late = fakeBitmap();
    calls[1]!.resolve(late);
    await settle();

    expect(late.closed).toBe(true);
    expect(repaints).toBe(1);
  });
});
