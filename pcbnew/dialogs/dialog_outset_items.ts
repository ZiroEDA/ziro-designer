// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_OUTSET_ITEMS` (`pcbnew/dialogs/dialog_outset_items.cpp`), the logic
 * half: the transfers between `OUTSET_ROUTINE::PARAMETERS` and the controls.
 * The window is `dialog_outset_items_ui.tsx`, a view over {@link OutsetSettings}.
 */
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { LSET_Name, LSET_NameToLayer } from '@ziroeda/common/layer_ids.js';
import type { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { OUTSET_PARAMETERS } from '../tools/item_modification_routine.js';
import type { TransferResult } from './dialog_text_properties.js';

/** The dialog's controls. */
export interface OutsetSettings {
  distanceIU: number;
  roundCorners: boolean;
  useSourceLayers: boolean;
  /** `m_LayerSelectionCtrl`'s layer, by its canonical name. */
  layer: string;
  useSourceWidths: boolean;
  lineWidthIU: number;
  /** `m_roundToGrid`. */
  roundToGrid: boolean;
  /** `m_roundingGrid`. */
  gridPitchIU: number;
  deleteSourceItems: boolean;
}

/** `s_presetGridRounding`: 0.01 is a common IPC grid round-off value. */
const s_presetGridRounding = [pcbIUScale.mmToIU(0.01)];

let s_gridRoundValuePersist = s_presetGridRounding[0]!;

export class DIALOG_OUTSET_ITEMS {
  constructor(private readonly m_params: OUTSET_PARAMETERS) {}

  TransferDataToWindow(): OutsetSettings {
    const p = this.m_params;

    return {
      layer: LSET_Name(p.layer),
      distanceIU: p.outsetDistance,
      roundCorners: p.roundCorners,
      lineWidthIU: p.lineWidth,
      roundToGrid: p.gridRounding !== null,
      gridPitchIU: p.gridRounding ?? s_gridRoundValuePersist,
      useSourceLayers: p.useSourceLayers,
      useSourceWidths: p.useSourceWidths,
      deleteSourceItems: p.deleteSourceItems,
    };
  }

  TransferDataFromWindow(v: OutsetSettings): TransferResult {
    if (v.lineWidthIU <= 0) return { ok: false, message: 'Line width must be a positive value.' };

    const p = this.m_params;

    p.layer = LSET_NameToLayer(v.layer as never) as PCB_LAYER_ID;
    p.outsetDistance = v.distanceIU;
    p.roundCorners = v.roundCorners;
    p.lineWidth = v.lineWidthIU;

    p.useSourceLayers = v.useSourceLayers;
    p.useSourceWidths = v.useSourceWidths;

    if (v.roundToGrid) p.gridRounding = v.gridPitchIU;
    else p.gridRounding = null;

    s_gridRoundValuePersist = v.gridPitchIU;

    p.deleteSourceItems = v.deleteSourceItems;

    return { ok: true };
  }
}
