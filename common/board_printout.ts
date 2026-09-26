// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/board_printout.cpp` + `include/board_printout.h`:
 * BOARD_PRINTOUT_SETTINGS, the printout parameters pcbnew and GerbView share.
 *
 * BOARD_PRINTOUT itself, the wxPrintout that draws a page through
 * `GAL_PRINT`, lands with `common/gal/cairo` and `common/gal/gal_print`.
 */

import { LSET } from './lset.js';
import type { PAGE_INFO } from './page_info.js';
import { PRINTOUT_SETTINGS } from './printout.js';
import type { APP_SETTINGS_BASE } from './settings/app_settings.js';

/**
 * Handle the parameters used to print a board drawing.
 */
export class BOARD_PRINTOUT_SETTINGS extends PRINTOUT_SETTINGS {
  m_LayerSet: LSET; ///< Layers to print
  m_Mirror: boolean; ///< Print mirrored

  constructor(aPageInfo: PAGE_INFO) {
    super(aPageInfo);
    this.m_LayerSet = new LSET();
    this.m_LayerSet.set();
    this.m_Mirror = false;
  }

  override Load(aConfig: APP_SETTINGS_BASE): void {
    super.Load(aConfig);

    this.m_LayerSet.reset();

    for (const layer of aConfig.m_Printing.layers) this.m_LayerSet.set(layer, true);

    this.m_Mirror = aConfig.m_Printing.mirror;
  }

  override Save(aConfig: APP_SETTINGS_BASE): void {
    super.Save(aConfig);

    aConfig.m_Printing.layers = [];

    for (let layer = 0; layer < this.m_LayerSet.size(); ++layer)
      if (this.m_LayerSet.test(layer)) aConfig.m_Printing.layers.push(layer);

    aConfig.m_Printing.mirror = this.m_Mirror;
  }
}
