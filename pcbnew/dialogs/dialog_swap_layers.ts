// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_SWAP_LAYERS` (pcbnew/dialogs/dialog_swap_layers.cpp): the grid of
 * "Move items on:" / "To layer:", one row per enabled copper layer, filling the
 * layer map GLOBAL_EDIT_TOOL::SwapLayers applies. The window that draws it is
 * dialog_swap_layers_ui.tsx.
 *
 * ## It is a one-way map, not a swap
 *
 * There is no swap operator upstream. Each row is "move items on X to Y", so
 * the result is any function from the enabled copper layers onto themselves;
 * mapping two layers onto one merges them without asking. A real swap is two
 * rows (F.Cu → B.Cu, B.Cu → F.Cu), which works because SwapLayers maps each
 * item's original layer set in one pass.
 */
import { LSET } from '@ziroeda/common/lset.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { BOARD } from '../board.js';

/** One grid row: `LAYER_GRID_TABLE`'s `std::pair<PCB_LAYER_ID, PCB_LAYER_ID>`. */
export interface SWAP_LAYERS_ROW {
  /** Column 0, read-only: the layer items are moved from. */
  from: PCB_LAYER_ID;
  /** Column 1: the layer they go to; a GRID_CELL_LAYER_SELECTOR over copper. */
  to: PCB_LAYER_ID;
}

export class DIALOG_SWAP_LAYERS {
  private m_rows: SWAP_LAYERS_ROW[] = [];

  /**
   * @param m_parent the frame; only its board is read.
   * @param m_layerMap filled by TransferDataFromWindow, as the C++ dialog's reference is.
   */
  constructor(
    private readonly m_parent: { GetBoard(): BOARD | null },
    private readonly m_layerMap: Map<PCB_LAYER_ID, PCB_LAYER_ID>,
  ) {}

  private enabledCopperLayers(): LSET {
    return LSET.AllCuMask(this.m_parent.GetBoard()!.GetCopperLayerCount());
  }

  /** One row per enabled copper layer in UI order (front, inners, back), each to itself. */
  TransferDataToWindow(): boolean {
    this.m_rows = [];

    for (const layer of this.enabledCopperLayers().UIOrder()) {
      this.m_rows.push({ from: layer, to: layer });
    }

    return true;
  }

  GetRows(): readonly SWAP_LAYERS_ROW[] {
    return this.m_rows;
  }

  /** The column-1 editor's `SetValueAsLong( row, 1, layer )`. */
  SetDestination(aRow: number, aLayer: PCB_LAYER_ID): void {
    const row = this.m_rows[aRow];

    if (row) row.to = aLayer;
  }

  /**
   * The layers the "To layer:" editor offers: the editor is built with
   * `LSET::AllNonCuMask()` as the layers it must NOT offer.
   */
  GetNotAllowedLayers(): LSET {
    return LSET.AllNonCuMask();
  }

  /** Every row whose destination is an enabled copper layer goes into the map. */
  TransferDataFromWindow(): boolean {
    const enabledCopperLayers = this.enabledCopperLayers();
    let row = 0;

    for (const layer of enabledCopperLayers.UIOrder()) {
      const dest = this.m_rows[row++]?.to ?? -1;

      if (dest >= 0 && dest < PCB_LAYER_ID.PCB_LAYER_ID_COUNT && enabledCopperLayers.Contains(dest))
        this.m_layerMap.set(layer, dest);
    }

    return true;
  }
}
