// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/widgets/gbr_layer_box_selector.h` + `.cpp`:
 * `GBR_LAYER_BOX_SELECTOR`, the active-layer `wxBitmapComboBox` on GerbView's
 * TOP_MAIN toolbar, and its `GBR_LAYER_PRESENTATION`.
 *
 * The class keeps the combo box's rows (name, swatch colours, the layer id as
 * client data) and its selection - what the C++ and its base
 * `LAYER_BOX_SELECTOR` (`common/widgets/layer_box_selector.cpp`) read and
 * write. The frame draws the rows through the shared `Combo`.
 */

import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { GAL_LAYER_ID, GERBER_DRAW_LAYER } from '@ziroeda/common/layer_id.js';
import { LAYER_BOX_SELECTOR } from '@ziroeda/common/widgets/layer_box_selector.js';
import { LAYER_PRESENTATION } from '@ziroeda/common/widgets/layer_presentation.js';
import { GERBER_FILE_IMAGE_LIST } from '../gerber_file_image_list.js';

/** `wxNOT_FOUND`. */
const wxNOT_FOUND = -1;

/** What `GBR_LAYER_PRESENTATION` asks of `GERBVIEW_FRAME`. */
export interface GBR_LAYER_BOX_FRAME {
  GetLayerColor(aLayer: number): Color4d;
}

/**
 * Gerbview-specific implementation of the LAYER_PRESENTATION interface.
 */
export class GBR_LAYER_PRESENTATION extends LAYER_PRESENTATION {
  constructor(private readonly m_frame: GBR_LAYER_BOX_FRAME) {
    super();
  }

  // Returns a color index from the layer id
  getLayerColor(aLayer: number): Color4d {
    return this.m_frame.GetLayerColor(GERBER_DRAW_LAYER(aLayer));
  }

  // Returns the name of the layer id
  getLayerName(aLayer: number): string {
    const images = GERBER_FILE_IMAGE_LIST.GetImagesList();
    const name = images.GetDisplayName(aLayer);

    return name;
  }
}

/**
 * One row of the combo box: `Append( name, bitmaps, (void*) layerid )`. The
 * bitmap is `LAYER_PRESENTATION::DrawColorSwatch( bmp, aLayer )`: the colour
 * over `getLayerColor( LAYER_PCB_BACKGROUND )`, both kept here for the
 * widget to composite (`common/gal/color4d.ts` `swatchOverBackground`).
 */
export interface GBR_LAYER_BOX_ROW {
  name: string;
  /** `getLayerColor( LAYER_PCB_BACKGROUND )`. */
  background: Color4d;
  /** `getLayerColor( aLayer )`. */
  color: Color4d;
  /** The client data: the layer id. */
  layerid: number;
}

// class to display a layer list in GerbView.
export class GBR_LAYER_BOX_SELECTOR extends LAYER_BOX_SELECTOR<GBR_LAYER_BOX_ROW> {
  private readonly m_layerPresentation: GBR_LAYER_PRESENTATION;

  constructor(aFrame: GBR_LAYER_BOX_FRAME) {
    super();
    this.m_layerPresentation = new GBR_LAYER_PRESENTATION(aFrame);
    this.m_layerhotkeys = false;
  }

  // Reload the Layers names and bitmaps
  Resync(): void {
    this.Clear();

    const images = GERBER_FILE_IMAGE_LIST.GetImagesList();

    for (let layerid = 0; layerid < images.ImagesMaxCount(); ++layerid) {
      if (!this.isLayerEnabled(layerid)) continue;

      // Don't show unused layers
      if (images.GetGbrImage(layerid) === null) continue;

      this.Append({
        name: this.m_layerPresentation.getLayerName(layerid),
        background: this.m_layerPresentation.getLayerColor(GAL_LAYER_ID.LAYER_PCB_BACKGROUND),
        color: this.m_layerPresentation.getLayerColor(layerid),
        layerid,
      });
    }

    // The best-size dance that follows upstream (select row 0, measure, set
    // the min size, deselect) leaves the selection where it started:
    // wxNOT_FOUND. The width is the Combo's own.
    if (this.GetCount()) this.SetSelection(wxNOT_FOUND);
  }

  // Return true if the layer id is enabled (i.e. is it should be displayed)
  isLayerEnabled(_aLayer: number): boolean {
    return true;
  }
}
