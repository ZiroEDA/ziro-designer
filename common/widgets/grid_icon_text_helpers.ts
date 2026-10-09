// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/widgets/grid_icon_text_helpers.h` + `common/widgets/grid_icon_text_helpers.cpp`:
 * `GRID_CELL_ICON_TEXT_RENDERER`, a cell that draws the icon matching its text before the text.
 * The view (`wx/grid_ui.tsx`) draws it from DrawValue's `icon`.
 */
import { bitmapUrl } from '../bitmap_store.js';
import { type wxGrid, wxGridCellRenderer, type wxGridCellDrawn } from '../wx/grid.js';

export class GRID_CELL_ICON_TEXT_RENDERER extends wxGridCellRenderer implements wxGridCellDrawn {
  constructor(
    private readonly m_icons: readonly string[],
    private readonly m_names: readonly string[],
  ) {
    super();
  }

  /**
   * `Draw`: the icon at the text's index in the names (the set of icons might be smaller than
   * the set of labels), then the text.
   */
  DrawValue(
    aValue: string,
    _aGrid: wxGrid,
    _aRow: number,
    _aCol: number,
  ): { label: string; icon?: string } {
    const position = this.m_names.indexOf(aValue);
    const icon =
      position >= 0 && position < this.m_icons.length
        ? bitmapUrl(this.m_icons[position]!)
        : undefined;

    return icon === undefined ? { label: aValue } : { label: aValue, icon };
  }
}
