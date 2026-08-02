// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Outset Items dialog's settings, and how they become engine options.
 * Counterpart: `OUTSET_ROUTINE::PARAMETERS` and
 * `DIALOG_OUTSET_ITEMS::TransferDataFromWindow`.
 *
 * Kept out of the .tsx so qa can typecheck and test it — the dialog itself is
 * layout, this is the part with a decision in it.
 */
import type { OutsetOptions } from '@ziroeda/pcbnew';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';

/** One field per `PARAMETERS` member. */
export interface OutsetSettings {
  distanceIU: number;
  roundCorners: boolean;
  useSourceLayers: boolean;
  layer: string;
  useSourceWidths: boolean;
  lineWidthIU: number;
  roundToGrid: boolean;
  gridPitchIU: number;
  deleteSourceItems: boolean;
}

/** Upstream's defaults: a 0.25 mm rounded courtyard at 0.05 mm line width. */
export const DEFAULT_OUTSET_SETTINGS: OutsetSettings = {
  distanceIU: mmToIU(0.25),
  roundCorners: true,
  useSourceLayers: false,
  layer: 'F.CrtYd',
  useSourceWidths: false,
  lineWidthIU: mmToIU(0.05),
  roundToGrid: false,
  gridPitchIU: mmToIU(0.01),
  deleteSourceItems: false,
};

/**
 * What the engine should be handed for these settings.
 *
 * The two "copy from source" checkboxes are expressed by *leaving the field
 * out*: absent already means "take it from the source item" to the engine, so
 * passing a flag as well would give the same intent two spellings that could
 * disagree. Likewise the grid pitch is only sent when rounding is on, so a
 * stale pitch left in the box cannot leak into the result.
 */
export function outsetOptionsFrom(s: OutsetSettings): OutsetOptions {
  return {
    distance: s.distanceIU,
    roundCorners: s.roundCorners,
    ...(s.useSourceLayers ? {} : { layer: s.layer }),
    ...(s.useSourceWidths ? {} : { lineWidth: s.lineWidthIU }),
    ...(s.roundToGrid ? { gridRounding: s.gridPitchIU } : {}),
    deleteSourceItems: s.deleteSourceItems,
  };
}
