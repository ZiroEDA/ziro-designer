// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Decoded reference-image bitmaps, kept between frames.
 * Counterpart: `BITMAP_BASE::m_bitmap` / `ImgToBitmap`, and the OpenGL bitmap
 * cache `KIGFX::VIEW::RecacheAllItems` invalidates.
 *
 * ## Why the scene cannot hold the picture
 *
 * The board scene is `Path2D` geometry, built synchronously from the model.
 * Decoding a PNG is neither: `createImageBitmap` returns a promise, and the
 * result is a `CanvasImageSource` rather than a path. So the scene carries the
 * *record* — payload, layer and destination box — and this cache carries the
 * pixels, exactly as `netLabels` are carried as data because their glyphs
 * depend on the frame.
 *
 * ## Decoding is once per payload, not once per frame or per item
 *
 * The key is the base64 payload itself, so two images of the same picture
 * decode once, and panning does not decode anything. A decode in flight is
 * remembered too — without that, every frame drawn while the first decode is
 * still running starts another one, which on a large PNG is how a board with
 * one reference image ends up with dozens of concurrent decodes.
 *
 * ## A failed decode is remembered as a failure
 *
 * A payload that will not decode is recorded as `null` rather than left
 * unknown. Unknown means "try again", and trying again every frame turns one
 * corrupt image into a permanent stall. `null` also tells the paint pass to
 * fall back to outlining the extent, which is what a reference image looked
 * like before any of this existed.
 */

/** What a decoded payload is worth to the canvas, or `null` if it will not decode. */
export type DecodedImage = CanvasImageSource | null;

/** Injected so the cache can be exercised without a browser's image decoder. */
export type ImageDecoder = (bytes: Uint8Array) => Promise<CanvasImageSource>;

/**
 * base64 → bytes.
 *
 * `atob` is the browser's own decoder and what `FileReader.readAsDataURL`
 * pairs with; going through it rather than a hand-rolled alphabet keeps the
 * padding rules someone else's problem.
 *
 * It also keeps the *whitespace* rules there. That matters, because the file
 * format splits the payload across quoted lines and a reader that rejoins them
 * with newlines is within its rights — so this has to tolerate them. `atob` is
 * specified as forgiving-base64, which strips ASCII whitespace before decoding,
 * so no pre-cleaning is needed. I wrote a strip anyway and mutation testing
 * showed it dead; the test that pins the requirement stays.
 */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The browser decoder: bytes → `ImageBitmap`, through a PNG blob. */
const decodeWithBrowser: ImageDecoder = (bytes) =>
  createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/png' }));

export class ReferenceImageCache {
  private readonly decoded = new Map<string, DecodedImage>();
  private readonly inFlight = new Set<string>();
  private readonly decode: ImageDecoder;

  constructor(decode: ImageDecoder = decodeWithBrowser) {
    this.decode = decode;
  }

  /** The bitmap for a payload: `undefined` while unknown, `null` once it has failed. */
  get(data: string): DecodedImage | undefined {
    return this.decoded.get(data);
  }

  /** Everything decoded so far, for handing to the paint pass. */
  get bitmaps(): ReadonlyMap<string, DecodedImage> {
    return this.decoded;
  }

  /**
   * Start decoding `data` if it is neither known nor already being decoded,
   * calling `onReady` when the answer changes — success or failure, since a
   * failure changes what gets painted too.
   */
  ensure(data: string, onReady: () => void): void {
    if (this.decoded.has(data) || this.inFlight.has(data)) return;
    this.inFlight.add(data);

    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(data);
    } catch {
      // Not even base64. Record the failure rather than retrying forever.
      this.inFlight.delete(data);
      this.decoded.set(data, null);
      onReady();
      return;
    }

    this.decode(bytes).then(
      (bitmap) => {
        this.inFlight.delete(data);
        this.decoded.set(data, bitmap);
        onReady();
      },
      () => {
        this.inFlight.delete(data);
        this.decoded.set(data, null);
        onReady();
      },
    );
  }
}
