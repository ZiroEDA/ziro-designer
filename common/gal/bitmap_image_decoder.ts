// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Ours: the pixels of an image that `WX_IMAGE` reads for its size only.
 *
 * KiCad decodes a JPEG through `wxJPEGHandler` (libjpeg) when the file is read, so by the time
 * `OPENGL_GAL` caches a bitmap its pixels are there. `WX_IMAGE` has no JPEG decoder
 * (wx_image.ts): it reads a JPEG's size and density and leaves its RGB plane null, and
 * `GL_BITMAP_CACHE::cacheBitmap` then has nothing to upload. A board whose reference images are
 * photographs - which are almost always JPEG - drew none of them, without an error.
 *
 * The browser has a JPEG decoder, `createImageBitmap`, in a window and in a worker alike. It is
 * asynchronous and a paint pass is not, so the first request starts the decode and answers
 * null; when the bitmap is ready `aOnDecoded` asks the panel to repaint, and the next request
 * hands it to `OPENGL_GAL`, which uploads it as it uploads any `TexImageSource`.
 *
 * - Keyed by `BITMAP_BASE::GetImageID`, as `GL_BITMAP_CACHE` is, so copies of one image (the
 *   render worker's board, an undo snapshot) decode once.
 * - What is decoded is `SaveImageData()`: the bytes as read from the file, which are the
 *   untransformed original - the same picture `cacheBitmap` takes from `GetOriginalImageData`.
 *   Mirror and rotation stay the GAL's texture coordinates.
 * - No colour management, as libjpeg applies none: `colorSpaceConversion: 'none'`.
 * - A failed decode is remembered as a failure, so a corrupt image is tried once rather than on
 *   every frame.
 */

import type { BITMAP_BASE } from '../bitmap_base.js';
import type { KIID } from '../kiid.js';
import { wxBitmapType } from '@ziroeda/wx/wx_image.js';

/** Encoded bytes -> pixels. Injected so the cache can be exercised without a browser. */
export type BITMAP_DECODE = (aBlob: Blob) => Promise<ImageBitmap>;

const decodeWithBrowser: BITMAP_DECODE = (aBlob) =>
  createImageBitmap(aBlob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });

export class BITMAP_IMAGE_DECODER {
  /** A decoded bitmap, or null once its decode has failed. Absent: not asked for yet. */
  private readonly m_decoded = new Map<KIID, ImageBitmap | null>();
  private readonly m_inFlight = new Set<KIID>();
  private m_destroyed = false;

  constructor(
    private readonly m_onDecoded: () => void,
    private readonly m_decode: BITMAP_DECODE | null = typeof createImageBitmap === 'function'
      ? decodeWithBrowser
      : null,
  ) {}

  /**
   * The pixels for \a aBitmap, or null while they are being decoded or when they cannot be.
   * Only for an image whose own pixels `WX_IMAGE` did not decode; the caller checks that.
   */
  Get(aBitmap: BITMAP_BASE): ImageBitmap | null {
    const id = aBitmap.GetImageID();
    const known = this.m_decoded.get(id);

    if (known !== undefined) return known;

    if (this.m_inFlight.has(id)) return null;

    const bytes = aBitmap.SaveImageData();

    if (!bytes || bytes.length === 0 || !this.m_decode) {
      this.m_decoded.set(id, null);
      return null;
    }

    const type = aBitmap.GetImageType() === wxBitmapType.wxBITMAP_TYPE_JPEG ? 'image/jpeg' : '';

    this.m_inFlight.add(id);
    this.m_decode(new Blob([bytes as BlobPart], { type })).then(
      (bitmap) => {
        this.m_inFlight.delete(id);

        if (this.m_destroyed) {
          bitmap.close();
          return;
        }

        this.m_decoded.set(id, bitmap);
        this.m_onDecoded();
      },
      () => {
        this.m_inFlight.delete(id);

        if (!this.m_destroyed) this.m_decoded.set(id, null);
      },
    );

    return null;
  }

  /** Release the decoded bitmaps; a decode still running is dropped when it lands. */
  Destroy(): void {
    this.m_destroyed = true;

    for (const bitmap of this.m_decoded.values()) bitmap?.close();

    this.m_decoded.clear();
  }
}
