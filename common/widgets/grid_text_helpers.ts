// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/widgets/grid_text_helpers.h` + `common/widgets/grid_text_helpers.cpp`:
 * `GRID_CELL_TEXT_EDITOR`, the text cell editor that keeps its own validator
 * and runs it on the key that opens it as well. The renderers of that file
 * are the view's (`wx/grid_ui.tsx`); the Scintilla editor is n/a.
 *
 * The validator here is `wxTextValidator( wxFILTER_EXCLUDE_CHAR_LIST )`, the
 * one KiCad grids set (`panel_text_variables.cpp`, `dialog_configure_paths.cpp`):
 * a character in the list is refused as it is typed.
 */
import { wxGridCellTextEditor } from '../wx/grid.js';

export class GRID_CELL_TEXT_EDITOR extends wxGridCellTextEditor {
  private m_excludes: string | null = null;

  /** `SetValidator( wxTextValidator( wxFILTER_EXCLUDE_CHAR_LIST ) )` with `SetCharExcludes`. */
  SetValidator(aExcludeChars: string): void {
    this.m_excludes = aExcludeChars;
  }

  /** `StartingKey`: the validator eats a refused key, and the text is left as it was. */
  override StartingKey(aChar: string): void {
    if (this.m_excludes?.includes(aChar)) return;

    super.StartingKey(aChar);
  }

  override FilterText(aText: string): string {
    const excludes = this.m_excludes;

    if (!excludes) return aText;

    return [...aText].filter((ch) => !excludes.includes(ch)).join('');
  }
}
