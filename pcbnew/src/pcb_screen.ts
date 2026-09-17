// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/pcb_screen.h` + `pcbnew/pcb_screen.cpp`: `PCB_SCREEN`, the
 * board editor's BASE_SCREEN with its active and via layers.
 */

import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { BASE_SCREEN } from '@ziroeda/common/src/base_screen.js';
import { B_Cu, F_Cu, type PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';

export class PCB_SCREEN extends BASE_SCREEN {
  m_Active_Layer: PCB_LAYER_ID;
  m_Route_Layer_TOP: PCB_LAYER_ID;
  m_Route_Layer_BOTTOM: PCB_LAYER_ID;

  constructor(aPageSizeIU: VECTOR2I) {
    super(aPageSizeIU);
    this.m_Active_Layer = F_Cu; // default active layer = front layer
    this.m_Route_Layer_TOP = F_Cu; // default layers pair for vias (bottom to top)
    this.m_Route_Layer_BOTTOM = B_Cu;
  }
}
