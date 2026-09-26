// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/preview_items/simple_overlay_item.cpp` +
 * `include/preview_items/simple_overlay_item.h`: `KIGFX::PREVIEW::
 * SIMPLE_OVERLAY_ITEM`, the base of the simple preview shapes drawn on the
 * GP overlay: it sets the GAL's stroke, fill and width, then hands the
 * drawing to the subclass.
 */

import { COLOR4D_WHITE, type Color4d } from '../color4d.js';
import { EDA_ITEM } from '../eda_item.js';
import type { GAL } from '../gal/graphics_abstraction_layer.js';
import { GAL_LAYER_ID } from '../layer_id.js';
import type { VIEW } from '../view/view.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';

/**
 * SIMPLE_OVERLAY_ITEM is class that represents a visual area drawn on
 * top of an existing canvas.
 *
 * The item is drawn on the GP overlay, with set stroke and fill colour and a
 * line width; subclasses draw the shape itself in drawPreviewShape.
 */
export class SIMPLE_OVERLAY_ITEM extends EDA_ITEM {
  private m_fillColor: Color4d;
  private m_strokeColor: Color4d;
  private m_lineWidth: number;

  constructor() {
    super(KICAD_T.NOT_USED); // this item is never added to a BOARD so it needs no type.
    this.m_fillColor = COLOR4D_WHITE;
    this.m_strokeColor = COLOR4D_WHITE;
    this.m_lineWidth = 1.0;
  }

  /**
   * Set up the GAL canvas (stroke, fill, width) and call drawPreviewShape.
   */
  override ViewDraw(_aLayer: number, aView: VIEW): void {
    const gal = aView.GetGAL()!;

    this.setupGal(gal);
    this.drawPreviewShape(aView);
  }

  /**
   * Set the overlay layer only.
   */
  override ViewGetLayers(): number[] {
    return [GAL_LAYER_ID.LAYER_GP_OVERLAY];
  }

  override GetClass(): string {
    return 'SIMPLE_OVERLAY_ITEM';
  }

  ///< Set the stroke color to set before drawing preview
  SetStrokeColor(aNewColor: Color4d): void {
    this.m_strokeColor = aNewColor;
  }

  ///< Set the fill color to set before drawing preview
  SetFillColor(aNewColor: Color4d): void {
    this.m_fillColor = aNewColor;
  }

  ///< Set the line width to set before drawing preview
  SetLineWidth(aNewWidth: number): void {
    this.m_lineWidth = aNewWidth;
  }

  /**
   * Set up the GAL options we have - the overriding class can add to this if
   * needed.
   */
  private setupGal(aGal: GAL): void {
    // default impl: set up the GAL options we have - the
    // overriding class can add to this if needed
    aGal.SetLineWidth(this.m_lineWidth);
    aGal.SetStrokeColor(this.m_strokeColor);
    aGal.SetFillColor(this.m_fillColor);
    aGal.SetIsStroke(true);
    aGal.SetIsFill(true);
  }

  /**
   * Draw the preview onto the given GAL. setupGal() will be called before this
   * function.
   *
   * Subclasses should implement this in terms of their own graphical data.
   */
  protected drawPreviewShape(_aView: VIEW): void {}
}
