// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/widgets/grid_combobox.h` + `common/widgets/grid_combobox.cpp`:
 * `GRID_CELL_COMBOBOX`, a grid cell editor over a `wxComboBox` built with the
 * default style - a list of names in a drop-down, and text the user may also
 * type (an adaptation of `wxGridCellChoiceEditor`, which only allows the list
 * when its `allowOthers` is off).
 *
 * The view draws the shared Combo over `m_choices`, as it does for the choice
 * editor it is.
 */
import { wxGridCellChoiceEditor } from '../wx/grid.js';

export class GRID_CELL_COMBOBOX extends wxGridCellChoiceEditor {
  constructor(aNames: readonly string[] = []) {
    super(aNames, true);
  }

  /** `Clone()`. */
  Clone(): GRID_CELL_COMBOBOX {
    return new GRID_CELL_COMBOBOX(this.m_choices);
  }
}
