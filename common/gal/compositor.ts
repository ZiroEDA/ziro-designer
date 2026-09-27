// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/gal/compositor.h`: `KIGFX::COMPOSITOR`, the base both
 * `OPENGL_COMPOSITOR` and `CAIRO_COMPOSITOR` derive from.
 */

import type { Color4d } from './color4d.js';

/**
 * Handle multitarget rendering (ie. to different textures/surfaces) and later compositing
 * into a single image (`gal/compositor.h`).
 */
export abstract class COMPOSITOR {
  protected m_width: number; ///< Width of the buffer (in pixels)
  protected m_height: number; ///< Height of the buffer (in pixels)

  constructor() {
    this.m_width = 0;
    this.m_height = 0;
  }

  /**
   * Perform primary initialization, necessary to use the object.
   */
  abstract Initialize(): void;

  /**
   * Clear the state of COMPOSITOR, so it has to be reinitialized again with the new
   * dimensions.
   *
   * @param aWidth is the framebuffer width (in pixels).
   * @param aHeight is the framebuffer height (in pixels).
   */
  abstract Resize(aWidth: number, aHeight: number): void;

  /**
   * Prepare a new buffer that may be used as a rendering target.
   *
   * @return is the handle of the buffer. In case of failure 0 (zero) is returned as the handle.
   */
  abstract CreateBuffer(): number;

  /**
   * Return currently used buffer handle.
   *
   * @return Currently used buffer handle.
   */
  abstract GetBuffer(): number;

  /**
   * Set the selected buffer as the rendering target.
   *
   * @param aBufferHandle is the handle of the buffer or 0 in case of rendering directly to
   *                      the display.
   */
  abstract SetBuffer(aBufferHandle: number): void;

  /**
   * Clear the selected buffer (set by the SetBuffer() function).
   */
  abstract ClearBuffer(aColor: Color4d): void;

  /**
   * Call this at the beginning of each frame.
   */
  abstract Begin(): void;

  /**
   * Draw the selected buffer to the output buffer.
   *
   * @param aBufferHandle is the handle of the buffer to be drawn.
   */
  abstract DrawBuffer(aBufferHandle: number): void;

  /**
   * Call this to present the output buffer to the screen.
   */
  abstract Present(): void;
}
