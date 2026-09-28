// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `LAYER_PRESENTATION` (`include/widgets/layer_presentation.h`,
 * `common/widgets/layer_presentation.cpp`): the base every layer-bearing widget
 * asks for a layer's colour and name. Each frame supplies a subclass
 * (`PCB_LAYER_PRESENTATION`, `GBR_LAYER_PRESENTATION`); the swatch compositing
 * is written once, here.
 *
 * `DrawColorSwatch` fills a `wxBitmap` upstream. What a browser widget needs
 * from that bitmap is its one colour, so both overloads return it as a
 * `Color4d`: the layer colour source-over the frame's opaque background
 * (`swatchOverBackground`), and the bare colour when the background is
 * `COLOR4D::UNSPECIFIED`, which skips the background fill.
 *
 * `CreateLayerPairIcon` is not ported: its only callers are the via-pair
 * toolbar selector in pcbnew, which is not built.
 */

import { type Color4d, COLOR4D_UNSPECIFIED, swatchOverBackground } from '../gal/color4d.js';
import { GAL_LAYER_ID } from '../layer_id.js';

const isUnspecified = (c: Color4d): boolean =>
  c.r === COLOR4D_UNSPECIFIED.r &&
  c.g === COLOR4D_UNSPECIFIED.g &&
  c.b === COLOR4D_UNSPECIFIED.b &&
  c.a === COLOR4D_UNSPECIFIED.a;

/**
 * Base class for an object that can provide information about
 * presenting layers (colours, etc).
 */
export abstract class LAYER_PRESENTATION {
  // Return a color index from the layer id
  abstract getLayerColor(aLayer: number): Color4d;

  // Return the name of the layer id
  abstract getLayerName(aLayer: number): string;

  /**
   * Fill the layer bitmap aLayerbmp with the layer color
   * (`layer_presentation.cpp:36-62`): the background with its alpha forced
   * to 1, then the colour over it. The black 1px border the bitmap also gets
   * is the swatch widget's to draw.
   */
  static DrawColorSwatch(aBackground: Color4d, aColor: Color4d): Color4d {
    if (isUnspecified(aBackground)) return aColor;

    return swatchOverBackground(aColor, aBackground);
  }

  /**
   * Fill the layer bitmap aLayerbmp with the layer color
   * for the layer ID (`layer_presentation.cpp:65-71`).
   */
  DrawColorSwatch(aLayer: number): Color4d {
    const bgColor = this.getLayerColor(GAL_LAYER_ID.LAYER_PCB_BACKGROUND);
    const color = this.getLayerColor(aLayer);

    return LAYER_PRESENTATION.DrawColorSwatch(bgColor, color);
  }
}
