// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/gal/gal_print.h`: `KIGFX::PRINT_CONTEXT` and `KIGFX::GAL_PRINT`,
 * the GAL a printout draws its pages with. `GAL_PRINT::Create` is defined in
 * `cairo_print.cpp` upstream and builds a `CAIRO_PRINT_GAL`; it does the same
 * here.
 *
 * The printer's `wxDC` is a canvas: {@link wxDC} is what the printout hands
 * over - the page's 2D context, its size in pixels and its resolution. Turning
 * the drawn canvases into printed pages is the printout's business.
 */

import type { Vec2, VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { CAIRO_SURFACE_BACKING } from './cairo/cairo_api.js';
import { CAIRO_PRINT_CTX, CAIRO_PRINT_GAL } from './cairo/cairo_print.js';
import type { GAL_DISPLAY_OPTIONS } from './gal_display_options.js';
import type { GAL } from './graphics_abstraction_layer.js';

/**
 * The `wxDC` a printout draws on: one page, as a canvas.
 *
 * `ctx` / `image` are the canvas's 2D context and the canvas; `GetSize()` is
 * its pixel size and `GetPPI()` the pixels per inch it was sized at (the page
 * size in inches times this is the canvas size).
 */
export interface wxDC extends CAIRO_SURFACE_BACKING {
  /** `wxDC::GetSize()`: the page, in device pixels. */
  GetSize(): VECTOR2I;
  /** `wxDC::GetPPI()`: device pixels per inch, the same on both axes. */
  GetPPI(): number;
}

export interface PRINT_CONTEXT {
  GetNativeDPI(): number;
  HasNativeLandscapeRotation(): boolean;
}

/**
 * Wrapper around GAL to provide information needed for printing.
 */
export interface GAL_PRINT {
  GetGAL(): GAL;

  GetPrintCtx(): PRINT_CONTEXT;

  /**
   * @param aSize is the printing sheet size expressed in inches.
   * @param aRotateIfLandscape true if the platform requires 90 degrees
   * rotation in order to print in landscape format.
   */
  SetNativePaperSize(aSize: Vec2, aRotateIfLandscape: boolean): void;

  /**
   * @param aSize is the schematics sheet size expressed in inches.
   */
  SetSheetSize(aSize: Vec2): void;

  /** The C++ destructor: the print context lets go of the page. */
  destroy(): void;
}

export const GAL_PRINT = {
  /** `static std::unique_ptr<GAL_PRINT> Create( GAL_DISPLAY_OPTIONS& aOptions, wxDC* aDC )`. */
  Create(aOptions: GAL_DISPLAY_OPTIONS, aDC: wxDC): GAL_PRINT {
    const printCtx = new CAIRO_PRINT_CTX(aDC);
    return new CAIRO_PRINT_GAL(aOptions, printCtx);
  },
};
