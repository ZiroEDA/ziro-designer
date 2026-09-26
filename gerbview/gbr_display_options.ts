// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/gbr_display_options.h`: `GBR_DISPLAY_OPTIONS`, how the Gerber
 * Viewer draws. "Some of these parameters are used only for printing, some
 * others only for drawing on screen."
 */
import { type Color4d, LEGACY_COLORS } from '@ziroeda/common/color4d.js';

export class GBR_DISPLAY_OPTIONS {
  /** Option to draw flashed items (filled/sketch). */
  m_DisplayFlashedItemsFill = true;
  /** Option to draw line items (filled/sketch). */
  m_DisplayLinesFill = true;
  /** Option to draw polygons (filled/sketch). */
  m_DisplayPolygonsFill = true;
  m_DisplayPageLimits = false;
  /** true when printing a page, false when drawing on screen. */
  m_IsPrinting = false;
  /** Display layers in transparency (alpha channel) forced mode. */
  m_ForceOpacityMode = false;
  /** Display layers in exclusive-or mode. */
  m_XORMode = false;
  /** High contrast mode (dim un-highlighted objects). */
  m_HighContrastMode = false;
  /** Display as a mirror image. */
  m_FlipGerberView = false;
  /**
   * The color used to draw negative objects, usually the background color,
   * but not always, when negative objects must be visible.
   * [data] `COLOR4D( DARKGRAY )`.
   */
  m_NegativeDrawColor: Color4d = LEGACY_COLORS.DARKGRAY;
  /** The alpha channel (opacity) value in opacity forced mode. [data] */
  m_OpacityModeAlphaValue = 0.6;
}
