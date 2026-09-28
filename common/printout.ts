// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/printout.cpp` + `include/printout.h`: PRINTOUT_SETTINGS, the
 * parameters every editor's print dialog edits and every printout reads.
 */

import type { PAGE_INFO } from './page_info.js';
import type { APP_SETTINGS_BASE } from './settings/app_settings.js';
import type { COLOR_SETTINGS } from './settings/color_settings.js';

/**
 * Handle the parameters used to print a board drawing.
 */
export class PRINTOUT_SETTINGS {
  m_scale: number; ///< Printing scale
  m_titleBlock: boolean; ///< Print frame and title block
  m_blackWhite: boolean; ///< Print in B&W or Color
  m_pageCount: number; ///< Number of pages to print
  m_background: boolean; ///< Print background color
  readonly m_pageInfo: PAGE_INFO;

  /// The color settings to be used for printing
  m_colorSettings: COLOR_SETTINGS | null;

  constructor(aPageInfo: PAGE_INFO) {
    this.m_pageInfo = aPageInfo;
    this.m_scale = 1.0;
    this.m_titleBlock = false;
    this.m_blackWhite = true;
    this.m_pageCount = 0;
    this.m_background = false;
    this.m_colorSettings = null;
  }

  Save(aConfig: APP_SETTINGS_BASE): void {
    aConfig.m_Printing.monochrome = this.m_blackWhite;
    aConfig.m_Printing.title_block = this.m_titleBlock;
    aConfig.m_Printing.scale = this.m_scale;
  }

  Load(aConfig: APP_SETTINGS_BASE): void {
    this.m_blackWhite = aConfig.m_Printing.monochrome;
    this.m_titleBlock = aConfig.m_Printing.title_block;
    this.m_scale = aConfig.m_Printing.scale;
  }

  /**
   * Returns true if the drawing border and title block should be printed.
   */
  PrintBorderAndTitleBlock(): boolean {
    return this.m_titleBlock;
  }
}
