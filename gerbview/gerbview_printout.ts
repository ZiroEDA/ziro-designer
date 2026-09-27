// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/gerbview_printout.cpp` + `.h`: GERBVIEW_PRINTOUT, one gerber
 * layer per page, drawn by GERBVIEW_PAINTER on CAIRO_PRINT_GAL.
 */

import { BOARD_PRINTOUT, type BOARD_PRINTOUT_SETTINGS } from '@ziroeda/common/board_printout.js';
import type { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import type { PAINTER } from '@ziroeda/common/gal/painter.js';
import { GERBVIEW_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import type { VIEW } from '@ziroeda/common/view/view.js';
import type { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { GBR_LAYOUT } from './gbr_layout.js';
import { GERBER_FILE_IMAGE_LIST } from './gerber_file_image_list.js';
import { gerbIUScale } from './gerbview.js';
import { GERBVIEW_PAINTER } from './gerbview_painter.js';

export class GERBVIEW_PRINTOUT extends BOARD_PRINTOUT {
  private m_layout: GBR_LAYOUT;

  constructor(aLayout: GBR_LAYOUT, aParams: BOARD_PRINTOUT_SETTINGS, aView: VIEW, aTitle: string) {
    super(aParams, aView, aTitle);
    this.m_layout = aLayout;
    this.m_gerbviewPrint = true;
  }

  override OnPrintPage(aPage: number): boolean {
    // Store the layerset, as it is going to be modified below and the original settings are needed
    const lset = this.m_settings.m_LayerSet;
    const seq = lset.UIOrder();

    if (aPage - 1 < 0 || aPage - 1 >= seq.length) return false;

    const layerId = seq[aPage - 1]!;

    // In gerbview, draw layers are always printed on separate pages because handling negative
    // objects when using only one page is tricky

    // Enable only one layer to create a printout
    this.m_settings.m_LayerSet = new LSET([layerId]);

    const gbrImgList = GERBER_FILE_IMAGE_LIST.GetImagesList();
    const gbrImage = gbrImgList.GetGbrImage(layerId);
    let gbr_filename = '';

    if (gbrImage) gbr_filename = gbrImage.m_FileName;

    this.DrawPage(gbr_filename, aPage, this.m_settings.m_pageCount);

    // Restore the original layer set, so the next page can be printed
    this.m_settings.m_LayerSet = lset;
    return true;
  }

  protected override milsToIU(aMils: number): number {
    return KiROUND(gerbIUScale.IU_PER_MILS * aMils);
  }

  protected override setupViewLayers(aView: VIEW, aLayerSet: LSET): void {
    super.setupViewLayers(aView, aLayerSet);

    for (const layer of this.m_settings.m_LayerSet.Seq())
      aView.SetLayerVisible(GERBVIEW_LAYER_ID.GERBVIEW_LAYER_ID_START + layer, true);
  }

  protected override setupGal(aGal: GAL): void {
    super.setupGal(aGal);
    aGal.SetWorldUnitLength(1.0 / gerbIUScale.IU_PER_MM /* 10 nm */ / 25.4 /* 1 inch in mm */);
  }

  protected override getBoundingBox(): BOX2I {
    return this.m_layout.ComputeBoundingBox();
  }

  protected override getPainter(aGal: GAL): PAINTER {
    return new GERBVIEW_PAINTER(aGal);
  }
}
