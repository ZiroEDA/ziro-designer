// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/bitmaps/bitmap_types.h` + `common/bitmap.cpp`: `KiBitmap` and
 * friends, over the one `BITMAP_STORE`. A bitmap is the URL of KiCad's icon
 * (see `BITMAP_STORE`), so the scaled-bitmap cache upstream keeps - "bitmap
 * conversions ... can be slow" - has nothing to cache and is not kept.
 */
import { BITMAP_STORE } from './bitmap_store.js';
import type { BITMAPS } from './bitmaps_list.js';

let s_BitmapStore: BITMAP_STORE | null = null;

export function GetBitmapStore(): BITMAP_STORE {
  if (!s_BitmapStore) s_BitmapStore = new BITMAP_STORE();

  return s_BitmapStore;
}

/** Construct a bitmap from a `BITMAPS` id. */
export function KiBitmap(aBitmap: BITMAPS, aHeightTag = -1): string {
  return GetBitmapStore().GetBitmap(aBitmap, aHeightTag);
}

export function KiBitmapBundle(aBitmap: BITMAPS, aMinHeight = -1): string {
  return GetBitmapStore().GetBitmapBundle(aBitmap, aMinHeight);
}

/** Constructs a bitmap bundle with the given default height. */
export function KiBitmapBundleDef(aBitmap: BITMAPS, aDefHeight: number): string {
  return GetBitmapStore().GetBitmapBundleDef(aBitmap, aDefHeight);
}

/**
 * A bitmap bundle for a disabled control: the file, which the element draws
 * through `--bitmap-disabled-filter` (`ConvertToDisabled( 70 )`).
 */
export function KiDisabledBitmapBundle(aBitmap: BITMAPS, aMinHeight = -1): string {
  return GetBitmapStore().GetDisabledBitmapBundle(aBitmap, aMinHeight);
}

export function KiDisabledBitmapBundleDef(aBitmap: BITMAPS, aDefHeight: number): string {
  return GetBitmapStore().GetDisabledBitmapBundleDef(aBitmap, aDefHeight);
}

/**
 * Return the automatic scale factor that would be used for a given window by
 * `KiScaledBitmap`. For historical reasons, 4 means unity (no scaling).
 *
 * @param aWindow gives `ConvertDialogToPixels( wxSize( 0, 8 ) ).y`, which on
 *                GTK is its character height (18 px on the measured desktop,
 *                `qa/probes/icon_scale_probe.cpp`).
 */
export function KiIconScale(aWindow: { GetCharHeight(): number }): number {
  // Eight vertical dialog units: MulDiv( 8, charHeight, 8 ).
  const vert_size = aWindow.GetCharHeight();

  // Autoscale won't exceed unity until the system has quite high resolution,
  // because we don't want the icons to look obviously scaled on a system
  // where it's easy to see it.
  if (vert_size > 34) return 8;
  else if (vert_size > 29) return 7;
  else if (vert_size > 24) return 6;
  else return 4;
}

/**
 * Construct a bitmap from a `BITMAPS` id, scaled to the window: the file, and
 * the scale its element is drawn at (`KiIconScale`, quantized to whole
 * multiples of 4 when asked).
 */
export function KiScaledBitmap(
  aBitmap: BITMAPS,
  aWindow: { GetCharHeight(): number },
  aHeight = -1,
  aQuantized = false,
): { url: string; scale: number } {
  let scale = KiIconScale(aWindow);

  if (aQuantized) scale = Math.round(scale / 4.0) * 4;

  return { url: GetBitmapStore().GetBitmapScaled(aBitmap, scale, aHeight), scale };
}

/** Wipe out the scaled bitmap cache: there is none (see above). */
export function ClearScaledBitmapCache(): void {}

/** `KiBitmapNew`: upstream's heap copy is the same file here. */
export function KiBitmapNew(aBitmap: BITMAPS): string {
  return GetBitmapStore().GetBitmap(aBitmap);
}
