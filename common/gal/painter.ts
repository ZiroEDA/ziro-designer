// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gal/painter.h` + `common/gal/painter.cpp`: `KIGFX::PAINTER`, the
 * contract between the VIEW and the class that knows how to draw items.
 */

import type { RENDER_SETTINGS } from '../render_settings.js';
import type { VIEW_ITEM } from '../view/view_item.js';
import type { GAL } from './graphics_abstraction_layer.js';

/**
 * Contains all the knowledge about how to draw graphical object onto any particular
 * output device.
 *
 * This knowledge is held outside the individual graphical objects so that alternative
 * output devices may be used, and so that the graphical objects themselves to not
 * contain drawing routines.  Drawing routines in the objects cause problems with usages
 * of the objects where they are not intended to be drawn.  So this class is intended to
 * be sub-classed for each output device type.  It is the responsibility of the sub-class
 * to draw the objects; this class defines the interface.  The graphical object's
 * bounding box is used to determine which GAL layer it is drawn on.
 */
export abstract class PAINTER {
  /// Instance of graphic abstraction layer that gives an interface to call
  /// commands used to draw (eg. DrawLine, DrawCircle, etc.)
  protected m_gal: GAL | null;

  /**
   * Initialize this object for painting on any of the polymorphic
   * GRAPHICS_ABSTRACTION_LAYER* derivatives.
   *
   * @param aGal is a pointer to a polymorphic GAL device on which to draw (i.e. Cairo,
   *             OpenGL, wxDC).
   */
  constructor(aGal: GAL | null) {
    this.m_gal = aGal;
  }

  /**
   * Change Graphics Abstraction Layer used for drawing items for a new one.
   *
   * @param aGal is the new GAL instance.
   */
  SetGAL(aGal: GAL | null): void {
    this.m_gal = aGal;
  }

  /**
   * Return a pointer to current settings that are going to be used when drawing items.
   *
   * @return Current rendering settings.
   */
  abstract GetSettings(): RENDER_SETTINGS;

  /**
   * Takes an instance of VIEW_ITEM and passes it to a function that knows how to draw
   * the item.
   *
   * @param aItem is an item to be drawn.
   * @param aLayer tells which layer is currently rendered so that draw functions may
   *               know what to draw (eg. for pads there are separate layers for holes,
   *               because they have other dimensions then the pad itself.
   */
  abstract Draw(aItem: VIEW_ITEM, aLayer: number): boolean;
}
