// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/gal/cairo/cairo_print.h` + `common/gal/cairo/cairo_print.cpp`:
 * `KIGFX::CAIRO_PRINT_CTX`, a Cairo context on a printer page or an image,
 * and `KIGFX::CAIRO_PRINT_GAL`, the GAL a printout draws with.
 *
 * The page is a canvas ({@link wxDC} in `gal_print.ts`). Upstream reaches the
 * platform's printing surface through a `wxGCDC`: on GTK it is Cairo's own,
 * given a device scale of 72/4800 so it prints at 4800 DPI; on Windows and
 * macOS the DPI is the DC's `GetPPI()`. A canvas has pixels, so the DPI here
 * is the one the page canvas was sized at, `aDC.GetPPI()` - the Windows/macOS
 * branch.
 */

import type { Vec2, VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { MATRIX3x3D } from '@ziroeda/kimath/src/math/matrix3x3.js';
import type { Color4d } from '../../color4d.js';
import { WX_IMAGE } from '../../wx/wx_image.js';
import type { GAL_DISPLAY_OPTIONS } from '../gal_display_options.js';
import type { GAL_PRINT, PRINT_CONTEXT, wxDC } from '../gal_print.js';
import type { GAL } from '../graphics_abstraction_layer.js';
import {
  cairo_antialias_t,
  cairo_create,
  cairo_destroy,
  cairo_format_t,
  cairo_image_surface_create,
  cairo_image_surface_create_for_data,
  cairo_reference,
  cairo_set_antialias,
  cairo_surface_destroy,
  cairo_surface_flush,
  cairo_surface_reference,
  type cairo_surface_t,
  type cairo_t,
} from './cairo_api.js';
import { CAIRO_GAL_BASE } from './cairo_gal.js';

const COLOR4D = (r: number, g: number, b: number, a: number): Color4d => ({ r, g, b, a });

/**
 * Provide a Cairo context created from wxPrintDC or an wxImage.
 *
 * It allows one to prepare printouts using the Cairo library and let wxWidgets handle the rest.
 */
export class CAIRO_PRINT_CTX implements PRINT_CONTEXT {
  private m_targetImage: WX_IMAGE | null = null;
  private m_ctx: cairo_t | null = null;
  private m_surface: cairo_surface_t | null = null;

  private m_dpi = 72.0;

  constructor(aImage: WX_IMAGE, aDPI: number);
  constructor(aDC: wxDC);
  constructor(a: WX_IMAGE | wxDC, aDPI?: number) {
    if (a instanceof WX_IMAGE) {
      const aImage = a;
      this.m_targetImage = aImage;
      this.m_dpi = aDPI!;

      this.m_surface = cairo_image_surface_create(
        cairo_format_t.CAIRO_FORMAT_ARGB32,
        aImage.GetWidth(),
        aImage.GetHeight(),
      );

      this.m_ctx = cairo_create(this.m_surface);

      cairo_set_antialias(this.m_ctx, cairo_antialias_t.CAIRO_ANTIALIAS_GOOD);
      return;
    }

    const aDC = a;
    const size: VECTOR2I = aDC.GetSize();

    this.m_surface = cairo_image_surface_create_for_data(
      aDC,
      cairo_format_t.CAIRO_FORMAT_ARGB32,
      size.x,
      size.y,
      size.x * 4,
    );
    this.m_ctx = cairo_create(this.m_surface);
    // wxASSERT( aDC->GetPPI().x == aDC->GetPPI().y ): one PPI here
    this.m_dpi = aDC.GetPPI();
  }

  /** `~CAIRO_PRINT_CTX()`: an image target gets the drawing, un-premultiplied. */
  destroy(): void {
    if (this.m_surface) {
      cairo_surface_flush(this.m_surface);

      if (this.m_targetImage) {
        // Convert data from cairo to wxImage
        const width = this.m_surface.width;
        const height = this.m_surface.height;
        const dstRGB = this.m_targetImage.GetData();
        const dstAlpha = this.m_targetImage.GetAlpha();

        if (dstRGB && dstAlpha && width > 0 && height > 0) {
          // getImageData is straight alpha already: the un-premultiply is the browser's
          const src = this.m_surface.backing.ctx.getImageData(0, 0, width, height).data;

          for (let i = 0; i < width * height; i++) {
            const alpha = src[i * 4 + 3]!;

            if (alpha === 0) {
              dstRGB[i * 3] = dstRGB[i * 3 + 1] = dstRGB[i * 3 + 2] = 0;
              dstAlpha[i] = 0;
            } else {
              dstRGB[i * 3] = src[i * 4]!;
              dstRGB[i * 3 + 1] = src[i * 4 + 1]!;
              dstRGB[i * 3 + 2] = src[i * 4 + 2]!;
              dstAlpha[i] = alpha;
            }
          }
        }
      }

      cairo_surface_destroy(this.m_surface);
    }

    if (this.m_ctx) cairo_destroy(this.m_ctx);
  }

  GetContext(): cairo_t {
    return this.m_ctx!;
  }

  GetSurface(): cairo_surface_t {
    return this.m_surface!;
  }

  GetNativeDPI(): number {
    return this.m_dpi;
  }

  /** `!( __WXGTK__ && !__WXGTK3__ )`: true on the GTK3 build this ports. */
  HasNativeLandscapeRotation(): boolean {
    return true;
  }
}

export class CAIRO_PRINT_GAL extends CAIRO_GAL_BASE implements GAL_PRINT {
  ///< Printout size
  private m_nativePaperSize!: Vec2;

  ///< Flag indicating whether the platform rotates page automatically or
  ///< GAL needs to handle it in the transformation matrix
  private m_hasNativeLandscapeRotation!: boolean;

  private m_printCtx!: CAIRO_PRINT_CTX;

  constructor(aDisplayOptions: GAL_DISPLAY_OPTIONS, aContext: CAIRO_PRINT_CTX) {
    super(aDisplayOptions);

    this.m_nativePaperSize = { x: 0, y: 0 };
    this.m_printCtx = aContext;
    this.m_context = this.m_currentContext = this.m_printCtx.GetContext();
    this.m_surface = this.m_printCtx.GetSurface();
    cairo_reference(this.m_context);
    cairo_surface_reference(this.m_surface);
    this.m_clearColor = COLOR4D(1.0, 1.0, 1.0, 1.0);
    this.m_hasNativeLandscapeRotation = false;
    this.resetContext();

    this.SetScreenDPI(this.m_printCtx.GetNativeDPI());
  }

  static Create(aOptions: GAL_DISPLAY_OPTIONS, aImage: WX_IMAGE, aDPI: number): CAIRO_PRINT_GAL {
    const printCtx = new CAIRO_PRINT_CTX(aImage, aDPI);
    return new CAIRO_PRINT_GAL(aOptions, printCtx);
  }

  /** `~CAIRO_PRINT_GAL()`: the base, then the owned print context. */
  override destroy(): void {
    super.destroy();
    this.m_printCtx.destroy();
  }

  override ComputeWorldScreenMatrix(): void {
    this.m_worldScale = this.m_screenDPI * this.m_worldUnitLength * this.m_zoomFactor;
    const paperSizeIU: Vec2 = {
      x: this.m_nativePaperSize.y /* inches */ / this.m_worldUnitLength /* 1" in IU */,
      y: this.m_nativePaperSize.x / this.m_worldUnitLength,
    };
    const paperSizeIUTransposed: Vec2 = { x: paperSizeIU.y, y: paperSizeIU.x };

    const scale = new MATRIX3x3D();
    const translation = new MATRIX3x3D();
    const flip = new MATRIX3x3D();
    const rotate = new MATRIX3x3D();
    const lookat = new MATRIX3x3D();

    scale.SetIdentity();
    translation.SetIdentity();
    flip.SetIdentity();
    rotate.SetIdentity();
    lookat.SetIdentity();

    const k = 0.5 / this.m_zoomFactor;

    if (this.m_hasNativeLandscapeRotation) {
      translation.SetTranslation({
        x: k * paperSizeIUTransposed.x,
        y: k * paperSizeIUTransposed.y,
      });
    } else {
      if (this.isLandscape()) {
        translation.SetTranslation({ x: k * paperSizeIU.x, y: k * paperSizeIU.y });
        rotate.SetRotation((90.0 * Math.PI) / 180.0);
      } else {
        translation.SetTranslation({
          x: k * paperSizeIUTransposed.x,
          y: k * paperSizeIUTransposed.y,
        });
      }
    }

    scale.SetScale({ x: this.m_worldScale, y: this.m_worldScale });
    flip.SetScale({ x: this.m_globalFlipX ? -1.0 : 1.0, y: this.m_globalFlipY ? -1.0 : 1.0 });
    lookat.SetTranslation({ x: -this.m_lookAtPoint.x, y: -this.m_lookAtPoint.y });

    this.m_worldScreenMatrix = scale.mul(translation).mul(flip).mul(rotate).mul(lookat);
    this.m_screenWorldMatrix = this.m_worldScreenMatrix.Inverse();
  }

  GetGAL(): GAL {
    return this;
  }

  GetPrintCtx(): PRINT_CONTEXT {
    return this.m_printCtx;
  }

  /**
   * @param aSize is the printing sheet size expressed in inches.
   * @param aHasNativeLandscapeRotation true if the platform requires 90 degrees rotation in order
   *                           to print in landscape format.
   */
  SetNativePaperSize(aSize: Vec2, aHasNativeLandscapeRotation: boolean): void {
    this.m_nativePaperSize = aSize;
    this.m_hasNativeLandscapeRotation = aHasNativeLandscapeRotation;
  }

  /**
   * @param aSize is the schematics sheet size expressed in inches.
   */
  SetSheetSize(aSize: Vec2): void {
    // Convert aSize (inches) to pixels
    this.SetScreenSize({
      x: Math.ceil(aSize.x * this.m_screenDPI) * 2,
      y: Math.ceil(aSize.y * this.m_screenDPI) * 2,
    });
  }

  ///< Returns true if page orientation is landscape
  private isLandscape(): boolean {
    return this.m_nativePaperSize.x > this.m_nativePaperSize.y;
  }
}
