// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/grid_layer_box_helpers.h` + `.cpp`: the grid cell renderer and
 * editor for a layer - a swatch and the layer's name, and a layer box to pick
 * one. Both read and write the cell as a long, the `PCB_LAYER_ID`
 * (`GetValueAsLong` / `SetValueAsLong`), whatever the cell's text is. How a
 * layer is presented (swatch, shown name) and which layers the box offers
 * come from the caller, as upstream takes them from the frame.
 */
import {
  type wxGrid,
  type wxGridCellChoiceView,
  type wxGridCellDrawn,
  wxGridCellEditor,
  wxGridCellStringRenderer,
} from '@ziroeda/common/wx/grid.js';

export interface GRID_LAYER_CHOICE {
  /** The `PCB_LAYER_ID`. */
  layer: number;
  label: string;
  swatch?: string;
}

/** `GRID_CELL_LAYER_RENDERER`: the layer's swatch and shown name. */
export class GRID_CELL_LAYER_RENDERER extends wxGridCellStringRenderer implements wxGridCellDrawn {
  constructor(private readonly m_present: (aLayer: number) => { label: string; swatch?: string }) {
    super();
  }

  DrawValue(
    _aValue: string,
    aGrid: wxGrid,
    aRow: number,
    aCol: number,
  ): { label: string; swatch?: string } {
    const { label, swatch } = this.m_present(aGrid.GetTable()!.GetValueAsLong(aRow, aCol));
    return swatch === undefined ? { label } : { label, swatch };
  }
}

/** `GRID_CELL_LAYER_SELECTOR`: a layer box over the layers not forbidden. */
export class GRID_CELL_LAYER_SELECTOR extends wxGridCellEditor implements wxGridCellChoiceView {
  constructor(private readonly m_choices: () => readonly GRID_LAYER_CHOICE[]) {
    super();
  }

  override BeginEdit(aRow: number, aCol: number, aGrid: wxGrid): void {
    this.m_startValue = String(aGrid.GetTable()!.GetValueAsLong(aRow, aCol));
    this.m_value = this.m_startValue;
  }

  override ApplyEdit(aRow: number, aCol: number, aGrid: wxGrid): void {
    aGrid.GetTable()!.SetValueAsLong(aRow, aCol, Number(this.m_value));
  }

  GetComboOptions(): readonly { value: string; label: string; swatch?: string }[] {
    return this.m_choices().map((c) =>
      c.swatch === undefined
        ? { value: String(c.layer), label: c.label }
        : { value: String(c.layer), label: c.label, swatch: c.swatch },
    );
  }
}
