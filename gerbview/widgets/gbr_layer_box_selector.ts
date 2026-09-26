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

import type { Color4d } from '@ziroeda/common/color4d.js';
import { GAL_LAYER_ID, GERBER_DRAW_LAYER, UNDEFINED_LAYER } from '@ziroeda/common/layer_id.js';
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
export class GBR_LAYER_PRESENTATION {
  constructor(private readonly m_frame: GBR_LAYER_BOX_FRAME) {}

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
 * widget to composite (`common/color4d.ts` `swatchOverBackground`).
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
export class GBR_LAYER_BOX_SELECTOR {
  private m_rows: GBR_LAYER_BOX_ROW[] = [];
  private m_selection = wxNOT_FOUND;
  private readonly m_layerPresentation: GBR_LAYER_PRESENTATION;
  /// LAYER_SELECTOR::m_layerhotkeys
  protected m_layerhotkeys: boolean;

  constructor(aFrame: GBR_LAYER_BOX_FRAME) {
    this.m_layerPresentation = new GBR_LAYER_PRESENTATION(aFrame);
    this.m_layerhotkeys = false;
  }

  // wxBitmapComboBox, as far as the C++ uses it

  Clear(): void {
    this.m_rows = [];
    this.m_selection = wxNOT_FOUND;
  }

  GetCount(): number {
    return this.m_rows.length;
  }

  GetRow(aIndex: number): GBR_LAYER_BOX_ROW | undefined {
    return this.m_rows[aIndex];
  }

  GetRows(): readonly GBR_LAYER_BOX_ROW[] {
    return this.m_rows;
  }

  GetSelection(): number {
    return this.m_selection;
  }

  SetSelection(aIndex: number): void {
    this.m_selection = aIndex >= 0 && aIndex < this.m_rows.length ? aIndex : wxNOT_FOUND;
  }

  // LAYER_SELECTOR

  SetLayersHotkeys(value: boolean): boolean {
    this.m_layerhotkeys = value;
    return this.m_layerhotkeys;
  }

  // LAYER_BOX_SELECTOR

  GetLayerSelection(): number {
    if (this.GetSelection() < 0) return UNDEFINED_LAYER;

    return this.m_rows[this.GetSelection()]!.layerid;
  }

  SetLayerSelection(layer: number): number {
    for (let i = 0; i < this.GetCount(); i++) {
      if (this.m_rows[i]!.layerid === layer) {
        if (this.GetSelection() !== i) {
          // Element (i) is not selected
          this.SetSelection(i);
          return i;
        }

        return i; // If element already selected; do nothing
      }
    }

    // Not Found
    this.SetSelection(-1);
    return -1;
  }

  // Reload the Layers names and bitmaps
  Resync(): void {
    this.Clear();

    const images = GERBER_FILE_IMAGE_LIST.GetImagesList();

    for (let layerid = 0; layerid < images.ImagesMaxCount(); ++layerid) {
      if (!this.isLayerEnabled(layerid)) continue;

      // Don't show unused layers
      if (images.GetGbrImage(layerid) === null) continue;

      this.m_rows.push({
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
