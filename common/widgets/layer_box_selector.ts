// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `LAYER_SELECTOR` and `LAYER_BOX_SELECTOR` (`include/widgets/layer_box_selector.h`,
 * `common/widgets/layer_box_selector.cpp`): the layer list every frame's
 * active-layer combo derives from.
 *
 * Upstream `LAYER_BOX_SELECTOR` is a `wxBitmapComboBox` and also a
 * `LAYER_SELECTOR`. TypeScript has one base, so `LAYER_BOX_SELECTOR` extends
 * `LAYER_SELECTOR` and carries the part of `wxBitmapComboBox` the C++ reads:
 * the rows, each with its layer id as client data, and the selection. A frame
 * draws the rows through the shared `Combo`.
 *
 * The `__WXMAC__` branches (Esc dismissing the popup, the disabled face) are
 * not ported; this is the GTK build.
 */

import { UNDEFINED_LAYER } from '../layer_id.js';

/** `wxNOT_FOUND`. */
const wxNOT_FOUND = -1;

/**
 * Base class to build a layer list.
 */
export abstract class LAYER_SELECTOR {
  protected m_layerhotkeys = true;

  SetLayersHotkeys(value: boolean): boolean {
    this.m_layerhotkeys = value;
    return this.m_layerhotkeys;
  }

  /// Return true if the layer id is enabled (i.e. is it should be displayed).
  protected abstract isLayerEnabled(aLayer: number): boolean;
}

/** One `Append( name, bitmap, (void*) layerid )`: at least the layer id. */
export interface LAYER_BOX_ROW {
  /** The client data: the layer id. */
  layerid: number;
}

/**
 * Display a layer list in a wxBitmapComboBox.
 */
export abstract class LAYER_BOX_SELECTOR<
  ROW extends LAYER_BOX_ROW = LAYER_BOX_ROW,
> extends LAYER_SELECTOR {
  protected m_rows: ROW[] = [];
  private m_selection = wxNOT_FOUND;

  // wxBitmapComboBox, as far as the C++ uses it

  Clear(): void {
    this.m_rows = [];
    this.m_selection = wxNOT_FOUND;
  }

  Append(aRow: ROW): void {
    this.m_rows.push(aRow);
  }

  GetCount(): number {
    return this.m_rows.length;
  }

  GetRow(aIndex: number): ROW | undefined {
    return this.m_rows[aIndex];
  }

  GetRows(): readonly ROW[] {
    return this.m_rows;
  }

  GetSelection(): number {
    return this.m_selection;
  }

  SetSelection(aIndex: number): void {
    this.m_selection = aIndex >= 0 && aIndex < this.m_rows.length ? aIndex : wxNOT_FOUND;
  }

  // LAYER_BOX_SELECTOR

  GetLayerSelection(): number {
    if (this.GetSelection() < 0) return UNDEFINED_LAYER;

    return this.m_rows[this.GetSelection()]!.layerid;
  }

  SetLayerSelection(layer: number): number {
    for (let i = 0; i < this.GetCount(); i++) {
      if (this.m_rows[i]!.layerid === layer) {
        if (this.GetSelection() !== i) {
          // Element (i) is not selected
          this.SetSelection(i);
          return i;
        }

        return i; // If element already selected; do nothing
      }
    }

    // Not Found
    this.SetSelection(-1);
    return -1;
  }

  // Reload the Layers
  // Virtual pure function because GerbView uses its own functions in a derived class
  abstract Resync(): void;
}
