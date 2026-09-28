// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GRID_BITMAP_BUTTON_RENDERER` (common/widgets/grid_button.cpp): a cell drawn
 * as a push button holding one bitmap, centred - the library tables' status
 * column (the warning, the settings cog, "open table"). Only the renderer is
 * here; `GRID_BUTTON_RENDERER` (the text button) has no caller yet.
 *
 * `Draw` is `DrawPushButton` around the bitmap inflated by `BUTTON_PADDING`
 * (2, 2); a view draws that as the shared `.ze-gridbtn` with the bitmap in it.
 */
import { wxGridCellRenderer } from '../wx/grid.js';

export class GRID_BITMAP_BUTTON_RENDERER extends wxGridCellRenderer {
  /** `m_bitmap`: the bundle, as the bitmap store's URL (`KiBitmapBundle`). */
  private readonly m_bitmap: string;

  constructor(aBitmap: string) {
    super();
    this.m_bitmap = aBitmap;
  }

  Clone(): GRID_BITMAP_BUTTON_RENDERER {
    return new GRID_BITMAP_BUTTON_RENDERER(this.m_bitmap);
  }

  /** The bitmap `Draw` paints. */
  GetBitmap(): string {
    return this.m_bitmap;
  }
}
