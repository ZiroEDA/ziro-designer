// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `view/view_item.h` / `common/view/view_item.cpp`: `KIGFX::VIEW_ITEM`, the
 * abstract base of everything a `VIEW` can hold.
 */

import type { BOX2I } from '@ziroeda/kimath/src/math/box2.js';

/** Define the how severely the appearance of the item has been changed. */
export enum VIEW_UPDATE_FLAGS {
  NONE = 0x00, ///< No updates are required.
  APPEARANCE = 0x01, ///< Visibility flag has changed.
  COLOR = 0x02, ///< Color has changed.
  GEOMETRY = 0x04, ///< Position or shape has changed.
  LAYERS = 0x08, ///< Layers have changed.
  INITIAL_ADD = 0x10, ///< Item is being added to the view.
  REPAINT = 0x20, ///< Item needs to be redrawn.
  ALL = 0xef, ///< All except INITIAL_ADD.
}

/** Define the visibility of the item (temporarily hidden, invisible, etc). */
export enum VIEW_VISIBILITY_FLAGS {
  VISIBLE = 0x01, ///< Item is visible (in general)

  /// Item is temporarily hidden (usually in favor of a being drawn from an overlay, such as a
  /// #SELECTION).  Overrides #VISIBLE flag.
  HIDDEN = 0x02,
  OVERLAY_HIDDEN = 0x04, ///< Item is temporarily hidden from being drawn on an overlay.
}

/**
 * `class VIEW_ITEM_DATA;` is forward-declared in the header; `VIEW` (view.cpp)
 * defines it. Until that lands the slot is typed by this declaration.
 */
// biome-ignore lint/suspicious/noEmptyInterface: a forward declaration, as the header's
export interface VIEW_ITEM_DATA {}

/** The part of `KIGFX::VIEW` that `lodScaleForThreshold` consults. */
export interface VIEW_FOR_LOD {
  GetPainter(): { GetSettings(): { IsPrinting(): boolean } };
}

/**
 * An abstract base class for deriving all objects that can be added to a VIEW.
 *
 * Its role is to:
 * - communicate geometry, appearance and visibility updates to the associated dynamic VIEW,
 * - provide a bounding box for redraw area calculation,
 * - (optional) draw the object using the #GAL API functions for #PAINTER-less implementations.
 *
 * VIEW_ITEM objects are never owned by a #VIEW. A single VIEW_ITEM can belong to any number of
 * static VIEWs, but only one dynamic VIEW due to storage of only one VIEW reference.
 */
export abstract class VIEW_ITEM {
  private m_isSCH_ITEM: boolean;
  private m_isBOARD_ITEM: boolean;
  /** `friend class VIEW`: the view writes this slot. */
  m_viewPrivData: VIEW_ITEM_DATA | null;
  private m_forcedTransparency: number; ///< Additional transparency for diff'ing items.

  constructor(isSCH_ITEM = false, isBOARD_ITEM = false) {
    this.m_isSCH_ITEM = isSCH_ITEM;
    this.m_isBOARD_ITEM = isBOARD_ITEM;
    this.m_viewPrivData = null;
    this.m_forcedTransparency = 0.0;
  }

  IsSCH_ITEM(): boolean {
    return this.m_isSCH_ITEM;
  }
  IsBOARD_ITEM(): boolean {
    return this.m_isBOARD_ITEM;
  }

  /**
   * Return the class name.
   */
  abstract GetClass(): string;

  /**
   * Return the bounding box of the item covering all its layers.
   *
   * @return the current bounding box.
   */
  abstract ViewBBox(): BOX2I;

  /**
   * Draw the parts of the object belonging to layer aLayer.
   *
   * An alternative way for drawing objects if there is no #PAINTER assigned for the view
   * or if the PAINTER doesn't know how to paint this particular implementation of VIEW_ITEM.
   * The preferred way of drawing is to design an appropriate PAINTER object, the method
   * below is intended only for quick hacks and debugging purposes.
   *
   * @param aLayer is the current drawing layer.
   * @param aView is a pointer to the #VIEW device we are drawing on.
   */
  ViewDraw(aLayer: number, aView: unknown): void {}

  /**
   * Return the all the layers within the VIEW the object is painted on.
   *
   * For instance, a #PAD spans zero or more copper layers and a few technical layers.
   * ViewDraw() or PAINTER::Draw() is repeatedly called for each of the layers returned
   * by ViewGetLayers(), depending on the rendering order.
   */
  abstract ViewGetLayers(): number[];

  /**
   * Return the level of detail (LOD) of the item.
   *
   * A level of detail is the minimal #VIEW scale that is sufficient for an item to be shown
   * on a given layer.
   *
   * Use @ref LOD_HIDE and @ref LOD_SHOW constants to hide or show the item unconditionally.
   *
   * Use @ref lodScaleForThreshold() to calculate the LOD scale for when the item
   * passes a certain threshold size on screen.
   *
   * @param aLayer is the current drawing layer.
   * @param aView is a pointer to the #VIEW device we are drawing on.
   * @return the level of detail. 0 always shows the item, because the actual zoom level
   *         (or VIEW scale) is always > 0
   */
  ViewGetLOD(aLayer: number, aView: VIEW_FOR_LOD | null): number {
    // By default always show the item
    return VIEW_ITEM.LOD_SHOW;
  }

  viewPrivData(): VIEW_ITEM_DATA | null {
    return this.m_viewPrivData;
  }

  SetForcedTransparency(aForcedTransparency: number): void {
    this.m_forcedTransparency = aForcedTransparency;
  }

  GetForcedTransparency(): number {
    return this.m_forcedTransparency;
  }

  /**
   * Return this constant from ViewGetLOD() to hide the item unconditionally.
   */
  static readonly LOD_HIDE = Number.MAX_VALUE;

  /**
   * Return this constant from ViewGetLOD() to show the item unconditionally.
   */
  static readonly LOD_SHOW = 0.0;

  /**
   * Get the scale at which aWhatIu would be drawn at the same size as
   * aThresholdIu on screen.
   *
   * This is useful when a level-of-detail is defined in terms of a threshold
   * size (i.e. 'only draw X when it will be bigger than Y size on screen').
   *
   * E.g. if aWhatIu is 1000 and aThresholdIu is 100, then the item will be
   * the same size as the threshold at 0.1 scale. Returning that 0.1 as the LoD
   * will hide the item when the scale is less than 0.1 - i.e. smaller than the
   * threshold.
   *
   * Because even at zoom 1.0, 1mm in KiCad may not be exactly 1mm on a physical
   * screen, the threshold may not be exact in practice.
   */
  protected static lodScaleForThreshold(
    aView: VIEW_FOR_LOD,
    aWhatIu: number,
    aThresholdIu: number,
  ): number {
    if (aView.GetPainter().GetSettings().IsPrinting()) return VIEW_ITEM.LOD_SHOW;

    if (aWhatIu === 0) return VIEW_ITEM.LOD_HIDE;

    return aThresholdIu / aWhatIu;
  }
}
