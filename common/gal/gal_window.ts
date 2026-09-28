// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The wxWindow an EDA_DRAW_PANEL_GAL adopts, as every editor's page builds it:
 * the `<canvas>`, the cursor art (`CURSOR_STORE::GetCursor` as CSS) and the
 * bitmap font atlas OPENGL_GAL uploads. One module, because the board
 * editor and GerbView need exactly the same window.
 */

import type { DRAW_PANEL_GAL_WINDOW } from '../draw_panel_gal.js';
import { KICURSOR } from './cursors.js';
import { type KiCursor, kiCursor } from './kicursors.js';

/** `KICURSOR` -> the designer's `CURSOR_STORE` name. */
export function cursorName(aCursor: KICURSOR): KiCursor {
  const name = KICURSOR[aCursor] ?? 'ARROW';
  const base = name.replace(/64$/, '');

  switch (base) {
    case 'DEFAULT':
      return 'ARROW';
    default:
      return base as KiCursor;
  }
}

/** The bitmap font atlas the GAL uploads, decoded once. */
let s_fontImage: Promise<ImageBitmap> | null = null;

export function loadBitmapFontImage(): Promise<ImageBitmap> {
  s_fontImage ??= (async () => {
    const url = new URL('../../../common/gal/opengl/bitmap_font_img.png', import.meta.url).href;
    const response = await fetch(url);

    if (!response.ok) throw new Error(`bitmap font atlas: ${response.status}`);

    // No colour management and no premultiplication: the three channels are
    // signed distances, not colours, and either transform would corrupt them.
    return await createImageBitmap(await response.blob(), {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
  })();

  return s_fontImage;
}

/** The window for a panel on `aCanvas`, once the font atlas is decoded. */
export function drawPanelWindow(
  aCanvas: HTMLCanvasElement,
  aFontImage: ImageBitmap,
): DRAW_PANEL_GAL_WINDOW {
  return {
    canvas: aCanvas,
    GetCursorCss: (aCursor: KICURSOR): string => kiCursor(cursorName(aCursor)),
    GetBitmapFontImage: (): TexImageSource => aFontImage,
  };
}
