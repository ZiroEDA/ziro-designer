// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `pcbnew/pad_utils.h` / `pad_utils.cpp`: `PAD_UTILS`, small pad helpers shared by the pad dialogs. */

import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import type { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { PAD } from './pad.js';
import { PAD_SHAPE } from './padstack.js';

/**
 * Get the default IPC-7351C rounding ratio for the given pad on the given layer.
 */
export function GetDefaultIpcRoundingRatio(aPad: PAD, aLayer: PCB_LAYER_ID): number {
  const defaultProportion = 0.25;
  const minimumSizeIU = pcbIUScale.mmToIU(0.25);

  const size = aPad.GetSize(aLayer);
  const padMinSizeIU = Math.min(size.x, size.y);
  const defaultRadiusIU = Math.min(minimumSizeIU, padMinSizeIU * defaultProportion);

  // Convert back to a ratio
  return defaultRadiusIU / padMinSizeIU;
}

/**
 * @brief Returns true if the pad's rounding ratio is valid (i.e. the pad
 * has a shape where that is meaningful)
 */
export function PadHasMeaningfulRoundingRadius(aPad: PAD, aLayer: PCB_LAYER_ID): boolean {
  const shape = aPad.GetShape(aLayer);
  return shape === PAD_SHAPE.ROUNDRECT || shape === PAD_SHAPE.CHAMFERED_RECT;
}
