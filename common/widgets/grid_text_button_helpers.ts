// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/widgets/grid_text_button_helpers.h` +
 * `common/widgets/grid_text_button_helpers.cpp`: the grid cell editors that
 * are a text entry with a button at its right (a `wxComboCtrl` with no popup).
 * The editor keeps the text and what the button does; the view
 * (`wx/grid_ui.tsx`) draws the entry and the button from
 * {@link GRID_CELL_TEXT_BUTTON_VIEW}.
 *
 * Only `GRID_CELL_RUN_FUNCTION_EDITOR` has a caller so far.
 */
import { KiBitmapBundle } from '../bitmap.js';
import { BITMAPS } from '../bitmaps/bitmaps_list.js';
import { type wxGrid, wxGridCellTextEditor } from '../wx/grid.js';

/** What the view needs from a text-and-button editor. */
export interface GRID_CELL_TEXT_BUTTON_VIEW {
  /** The button's bitmap, as the bitmap store's URL. */
  GetButtonBitmap(): string;
  /** `OnButtonClick`. */
  OnButtonClick(): void;
}

/** `GRID_CELL_TEXT_BUTTON`: the text half; a subclass says what the button does. */
export abstract class GRID_CELL_TEXT_BUTTON
  extends wxGridCellTextEditor
  implements GRID_CELL_TEXT_BUTTON_VIEW
{
  protected m_row = -1;
  protected m_col = -1;

  override BeginEdit(aRow: number, aCol: number, aGrid: wxGrid): void {
    this.m_row = aRow;
    this.m_col = aCol;
    super.BeginEdit(aRow, aCol, aGrid);
  }

  abstract GetButtonBitmap(): string;
  abstract OnButtonClick(): void;
}

/**
 * `GRID_CELL_RUN_FUNCTION_EDITOR`: the button (`BITMAPS::small_refresh`,
 * `TEXT_BUTTON_RUN_FUNCTION`) runs a function of the edited cell.
 */
export class GRID_CELL_RUN_FUNCTION_EDITOR extends GRID_CELL_TEXT_BUTTON {
  constructor(private readonly m_function: (aRow: number, aCol: number) => void) {
    super();
  }

  GetButtonBitmap(): string {
    return KiBitmapBundle(BITMAPS.small_refresh);
  }

  OnButtonClick(): void {
    this.m_function(this.m_row, this.m_col);
  }
}
