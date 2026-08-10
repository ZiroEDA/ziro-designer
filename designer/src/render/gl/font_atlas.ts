// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Fetching and decoding the bitmap-font sheet, once per page.
 *
 * The image is an ordinary asset next to its metrics rather than a data URI, so
 * the bundler fingerprints it, the browser caches it, and it does not sit in the
 * JavaScript bundle being re-parsed on every load. `new URL(..., import.meta.url)`
 * is what makes that resolve correctly under any base path, and it degrades to a
 * `file://` URL under Node, where there is no decoder anyway and every caller
 * has to cope with "no atlas yet" regardless.
 *
 * Decoding is asynchronous and a board can be drawn before it finishes, so the
 * device draws glyph runs only once the texture exists and asks for one more
 * frame when it arrives. That costs a redraw on first load and nothing after.
 */

/** Resolved once; every device shares the same decoded image. */
let pending: Promise<ImageBitmap | null> | null = null;

/**
 * The decoded sheet, or null when this environment cannot produce one.
 *
 * Never rejects: a missing atlas means net names fall back to nothing drawn,
 * which is a great deal better than a board that throws.
 */
export function loadFontAtlas(): Promise<ImageBitmap | null> {
  pending ??= decode();
  return pending;
}

async function decode(): Promise<ImageBitmap | null> {
  if (typeof fetch !== 'function' || typeof createImageBitmap !== 'function') return null;
  try {
    const url = new URL('./bitmap_font.png', import.meta.url).href;
    const response = await fetch(url);
    if (!response.ok) return null;
    // No colour management and no premultiplication: the three channels are
    // signed distances, not colours, and either transform would corrupt them.
    return await createImageBitmap(await response.blob(), {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
  } catch {
    return null;
  }
}

/** Forget the cached image. Tests only; the app loads it once and keeps it. */
export function resetFontAtlasForTest(): void {
  pending = null;
}
