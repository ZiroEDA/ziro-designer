// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gal/graphics_abstraction_layer.h`: `KIGFX::GAL`, the abstract drawing
 * interface. This carries the part the text stack drives (`FONT::Draw` sets
 * the line width and hands glyphs to `DrawGlyphs`); the drawing surface
 * grows with the VIEW/PAINTER port on the same class.
 */

import type { GLYPH_LIKE } from '../font/glyph.js';

export abstract class GAL {
  protected m_lineWidth = 1.0;

  /**
   * Set the line width.
   *
   * @param aLineWidth is the line width.
   */
  SetLineWidth(aLineWidth: number): void {
    this.m_lineWidth = aLineWidth;
  }

  /**
   * Get the line width.
   *
   * @return the actual line width.
   */
  GetLineWidth(): number {
    return this.m_lineWidth;
  }

  /**
   * Draw a text glyph.
   */
  abstract DrawGlyph(aGlyph: GLYPH_LIKE, aNth: number, aTotal: number): void;

  /**
   * Draw a set of text glyphs.
   */
  DrawGlyphs(aGlyphs: readonly GLYPH_LIKE[]): void {
    for (let i = 0; i < aGlyphs.length; i++) this.DrawGlyph(aGlyphs[i]!, i, aGlyphs.length);
  }
}
