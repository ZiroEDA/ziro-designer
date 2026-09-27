// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Resolves each toolbar tool id to KiCad's own icon (the dark-theme SVGs
 * vendored under assets/toolbar). The id-to-bitmap table lives in
 * `toolbar_bitmaps.ts`; only the file lookup is here, because `import.meta.glob`
 * is Vite-only and would make the table untestable.
 */
import { svgUrl } from '@ziroeda/bitmaps_png';
import { BITMAP } from './bitmap_store_actions.js';
import { BITMAPS } from './bitmaps_list.js';

/** KiCad icon URL for a toolbar tool id, or undefined if none is mapped. */
export function toolbarIconUrl(id: string): string | undefined {
  const name = BITMAP[id];
  return name ? svgUrl('toolbar', name) : undefined;
}

/**
 * A KiCad bitmap by NAME, for the call sites that are not toolbars.
 *
 * `BITMAPS::text_align_left` and friends are set directly on controls all over
 * KiCad — `properties_frame.cpp:100-120` gives the drawing sheet's eight
 * format buttons theirs this way — and those call sites have no tool id to go
 * through `BITMAP`. Same vendored files, same glob, one lookup.
 */
export function bitmapUrl(name: string): string | undefined {
  return svgUrl('toolbar', name);
}

/**
 * `s_imageNotFound`, the 24 px PNG upstream draws for a bitmap its archive
 * lacks (data: KiCad's own table, bitmap_store.cpp).
 */
const IMAGE_NOT_FOUND =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAQAAABKfvVzAAABq0lEQVQ4y43UPywDURgA8EsMIrEZjEYJYmBoYiCxmCQkdwjSEAMGi5CYSCU6NBKxGQyiNP7EJCmToQxSf+LPIFqDobT3p3fv3t3T3tF+ehfa4rXufdt93+/eu/veewwLbPp3cEafaQVn/skBw6aZoqG1i4GkmiD3yjkKKxGEDOEgVVfI56oLgLTwd8/aemYC2Hy4YfM9iXEbFWhNsjFUVPwdCyAhXEMBDCME1z9YmIV980aJokvk+yLBlDJPBXqz8PaoSryyqHeRVtwrPi9nLeCBeJgKGEbx4B6oyL9g+ARbYAYS0RLg5xDXAqYFvBAPOQDJ+RcyYn/Dma5N/QOgUtx50Mfs8tWMFIOqskCoFq9PifWLOfCbooDrqX0oAofHKS5XPgghIt7qtSU6nW9gQ5wM2OWPurQNlcU5Ohg/Itbadw1p63eOCtSFvaw7t4suVNztCOA5+c0KRdc6HYFyowRQXcgr+7QOh0AZfdX9mY1sTEtOOwJ8bMbu8GTuHDgCMnHboB/Uj8LOLTfD1Yp9CpaAf3I0g9Yo8U8ogiRZddEA5ZqxLhrOoD1n4RO1xX63aQhTXAAAAABJRU5ErkJggg==';

/** `s_dummyItem`: the 16 px icon of an EDA_ITEM with none of its own (data, as above). */
const DUMMY_ITEM =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAX0lEQVQ4y2P4//8/AyWYYWgaAARGQPwCiEVBHHYg/gHEviQYYAHEIIYEiMMB5QQMuAE3gfgEkfgKVI8GsgGbgXgCkXgFVI/K4AgDNqi/7MgygMyEBAq8HUAsyDD0MxMAaxpGe2jnDwsAAAAASUVORK5CYII=';

/**
 * `BITMAP_STORE`: KiCad's icons by `BITMAPS` id.
 *
 * Upstream reads PNGs out of `images.tar.gz`, one per theme and height, and
 * a `wxBitmap` is pixels. We ship KiCad's SVG sources (`bitmaps_png/`), dark
 * only (the dark theme is the identity here), so a bitmap is the URL of one
 * vector file: every height is the same file, and a bundle is that file.
 *
 * A disabled bundle is the same file drawn through `ConvertToDisabled( 70 )`
 * (dark theme), which a page does with the `--bitmap-disabled-filter` token
 * in `shell.css` where the image is drawn; `WX_IMAGE.ConvertToDisabled` is
 * the pixel form, for an image in hand.
 */
export class BITMAP_STORE {
  /** `GetBitmap( aBitmapId, aHeight )`. */
  GetBitmap(aBitmapId: BITMAPS, _aHeight = -1): string {
    return this.getImage(aBitmapId);
  }

  /** `GetBitmapBundle( aBitmapId, aMinHeight )`. */
  GetBitmapBundle(aBitmapId: BITMAPS, _aMinHeight = -1): string {
    return this.getImage(aBitmapId);
  }

  /** `GetBitmapBundleDef( aBitmapId, aDefHeight )`. */
  GetBitmapBundleDef(aBitmapId: BITMAPS, _aDefHeight: number): string {
    return this.getImage(aBitmapId);
  }

  /** `GetDisabledBitmapBundle`: the file; the element draws it disabled. */
  GetDisabledBitmapBundle(aBitmapId: BITMAPS, _aMinHeight = -1): string {
    return this.getImage(aBitmapId);
  }

  /** `GetDisabledBitmapBundleDef`. */
  GetDisabledBitmapBundleDef(aBitmapId: BITMAPS, _aDefHeight: number): string {
    return this.getImage(aBitmapId);
  }

  /**
   * `GetBitmapScaled`: upstream rescales the pixels to `aScaleFactor / 4`. A
   * vector file draws at whatever size the element gives it.
   */
  GetBitmapScaled(aBitmapId: BITMAPS, _aScaleFactor: number, _aHeight = -1): string {
    return this.getImage(aBitmapId);
  }

  /** `ThemeChanged`: the icon theme is always dark here, so nothing changes. */
  ThemeChanged(): void {}

  /** `getImage`: the file, `s_dummyItem`, or `s_imageNotFound`. */
  private getImage(aBitmapId: BITMAPS): string {
    if (aBitmapId === BITMAPS.dummy_item) return DUMMY_ITEM;

    const name = BITMAPS[aBitmapId];

    return (name === undefined ? undefined : svgUrl('toolbar', name)) ?? IMAGE_NOT_FOUND;
  }
}
