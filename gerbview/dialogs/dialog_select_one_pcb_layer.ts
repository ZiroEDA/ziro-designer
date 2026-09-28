// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/dialogs/dialog_select_one_pcb_layer.cpp`: `SELECT_LAYER_DIALOG`,
 * the "Select Layer: "name"" dialog the map dialog's "..." buttons open
 * through `GERBVIEW_FRAME::SelectPCBLayer` (which lives in `gerbview_frame.ts`
 * with the frame, since its only job is to show this).
 *
 * The dialog is one `wxRadioBox` ("Layer") and an OK/Cancel column; the state
 * lives here and `dialog_select_one_pcb_layer_ui.tsx` draws it. Upstream has no
 * `_base.cpp` for it — the sizers are built in the constructor (`:84-160`).
 *
 * Picking a radio button closes the dialog at once, as OK: `OnLayerSelected`
 * posts `wxID_OK` (`:163-166`).
 */

import { UNDEFINED_LAYER, UNSELECTED_LAYER } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import type { GERBVIEW_FRAME } from '../gerbview_frame.js';

/**
 * The radio box's major dimension: `std::min( int( m_layerId.size() ), 12 )`
 * rows, `wxRA_SPECIFY_ROWS` (`:144-146`). [data]
 */
export const SELECT_LAYER_MAX_ROWS = 12;

export class SELECT_LAYER_DIALOG {
  /** The window title, `_( "Select Layer: %s" )`. */
  readonly m_title: string;
  /** The radio box's labels, in order. */
  readonly m_layerList: string[] = [];
  /** The layer id behind each radio button. */
  readonly m_layerId: number[] = [];
  /**
   * `m_layerRadioBox->GetSelection()`. A wxRadioBox always has one button
   * set, the first until `SetSelection`, so a default layer the list does
   * not hold leaves the first (F.Cu) selected.
   */
  m_layerRadioBox = 0;

  private m_selectedLayer: number;

  constructor(
    _aParent: GERBVIEW_FRAME,
    aDefaultLayer: number,
    aCopperLayerCount: number,
    aGerberName: string,
  ) {
    this.m_title = `Select Layer: ${aGerberName}`;

    let selected = -1;

    // Store the passed default layer in case the user hits Cancel
    this.m_selectedLayer = aDefaultLayer;

    // Build the layer list; first build copper layers list
    const layers = LSET.AllCuMask(aCopperLayerCount).or(LSET.AllTechMask()).or(LSET.UserMask());

    for (const layer of layers.copperLayers()) {
      this.m_layerList.push(LSET.Name(layer));

      if (aDefaultLayer === layer) selected = this.m_layerId.length;

      this.m_layerId.push(layer);
    }

    for (const layer of layers.nonCopperLayers()) {
      this.m_layerList.push(LSET.Name(layer));

      if (aDefaultLayer === layer) selected = this.m_layerId.length;

      this.m_layerId.push(layer);
    }

    this.m_layerList.push('Hole data');

    if (aDefaultLayer === UNDEFINED_LAYER) selected = this.m_layerId.length;

    this.m_layerId.push(UNDEFINED_LAYER);

    this.m_layerList.push('Do not export');

    if (aDefaultLayer === UNSELECTED_LAYER) selected = this.m_layerId.length;

    this.m_layerId.push(UNSELECTED_LAYER);

    if (selected >= 0) this.m_layerRadioBox = selected;
  }

  /** The radio box's rows: `std::min( int( m_layerId.size() ), 12 )`. */
  GetMajorDimension(): number {
    return Math.min(this.m_layerId.length, SELECT_LAYER_MAX_ROWS);
  }

  GetSelectedLayer(): number {
    return this.m_selectedLayer;
  }

  /** `TransferDataFromWindow` (`:169-176`). */
  TransferDataFromWindow(): boolean {
    this.m_selectedLayer = this.m_layerId[this.m_layerRadioBox]!;
    return true;
  }
}
