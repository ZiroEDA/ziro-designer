// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/gal/cairo/cairo_compositor.h` + `common/gal/cairo/cairo_compositor.cpp`:
 * `KIGFX::CAIRO_COMPOSITOR`, which handles multitarget rendering (ie. to
 * different textures/surfaces) and later compositing into a single image
 * (Cairo flavour).
 *
 * A buffer is an image surface, which `cairo_api.ts` backs with a canvas: the
 * `new uint8_t[m_bufferSize]()` pixel store is that canvas, and `memset` to
 * zero is a `clearRect`.
 */

import type { Color4d } from '../../color4d.js';
import { GAL_ANTIALIASING_MODE } from '../gal_display_options.js';
import { COMPOSITOR } from '../compositor.js';
import {
  cairo_antialias_t,
  cairo_create,
  cairo_destroy,
  cairo_format_stride_for_width,
  cairo_format_t,
  cairo_get_matrix,
  cairo_identity_matrix,
  cairo_image_surface_create,
  cairo_matrix_init_identity,
  cairo_matrix_new,
  type cairo_matrix_t,
  cairo_operator_t,
  cairo_paint,
  cairo_set_antialias,
  cairo_set_matrix,
  cairo_set_operator,
  cairo_set_source_surface,
  cairo_surface_destroy,
  type cairo_surface_t,
  type cairo_t,
} from './cairo_api.js';
import { wxASSERT } from '@ziroeda/core/wx_assert.js';

/**
 * `cairo_t** aMainContext`: the GAL's `m_currentContext`, which the
 * compositor both reads and repoints at a buffer.
 */
export interface CAIRO_CONTEXT_REF {
  get(): cairo_t;
  set(aContext: cairo_t): void;
}

interface CAIRO_BUFFER {
  context: cairo_t; ///< Main texture handle
  surface: cairo_surface_t; ///< Point to which an image from texture is attached
}

export class CAIRO_COMPOSITOR extends COMPOSITOR {
  protected m_current: number; ///< Currently used buffer handle

  /// Pointer to the current context, so it can be changed
  protected m_currentContext: CAIRO_CONTEXT_REF;

  /// Rendering target used for compositing (the main display)
  protected m_mainContext: cairo_t;

  /// Transformation matrix
  protected m_matrix: cairo_matrix_t;

  /// Stores information about initialized buffers
  protected m_buffers: CAIRO_BUFFER[];

  protected m_stride: number; ///< Stride to use given the desired format and width
  protected m_bufferSize: number; ///< Amount of memory needed to store a buffer

  protected m_currentAntialiasingMode: cairo_antialias_t;

  constructor(aMainContext: CAIRO_CONTEXT_REF) {
    super();
    this.m_current = 0;
    this.m_currentContext = aMainContext;
    this.m_mainContext = aMainContext.get();
    this.m_currentAntialiasingMode = cairo_antialias_t.CAIRO_ANTIALIAS_DEFAULT;
    this.m_buffers = [];

    // Do not have uninitialized members:
    this.m_matrix = cairo_matrix_new();
    cairo_matrix_init_identity(this.m_matrix);
    this.m_stride = 0;
    this.m_bufferSize = 0;
  }

  /** `~CAIRO_COMPOSITOR()`. */
  destroy(): void {
    this.clean();
  }

  /// @copydoc COMPOSITOR::Initialize()
  override Initialize(): void {
    // Nothing has to be done
  }

  /// clears all buffers
  SetAntialiasingMode(aMode: GAL_ANTIALIASING_MODE): void {
    switch (aMode) {
      case GAL_ANTIALIASING_MODE.AA_FAST:
        this.m_currentAntialiasingMode = cairo_antialias_t.CAIRO_ANTIALIAS_FAST;
        break;
      case GAL_ANTIALIASING_MODE.AA_HIGHQUALITY:
        this.m_currentAntialiasingMode = cairo_antialias_t.CAIRO_ANTIALIAS_GOOD;
        break;
      default:
        this.m_currentAntialiasingMode = cairo_antialias_t.CAIRO_ANTIALIAS_NONE;
    }

    this.clean();
  }

  GetAntialiasingMode(): GAL_ANTIALIASING_MODE {
    switch (this.m_currentAntialiasingMode) {
      case cairo_antialias_t.CAIRO_ANTIALIAS_FAST:
        return GAL_ANTIALIASING_MODE.AA_FAST;
      case cairo_antialias_t.CAIRO_ANTIALIAS_GOOD:
        return GAL_ANTIALIASING_MODE.AA_HIGHQUALITY;
      default:
        return GAL_ANTIALIASING_MODE.AA_NONE;
    }
  }

  /// @copydoc COMPOSITOR::Resize()
  override Resize(aWidth: number, aHeight: number): void {
    this.clean();

    this.m_width = aWidth;
    this.m_height = aHeight;

    this.m_stride = cairo_format_stride_for_width(cairo_format_t.CAIRO_FORMAT_ARGB32, this.m_width);
    this.m_bufferSize = this.m_stride * this.m_height;
  }

  /// @copydoc COMPOSITOR::CreateBuffer()
  override CreateBuffer(): number {
    // Pixel storage, and the Cairo surface over it: a fresh canvas is all zero
    const surface = cairo_image_surface_create(
      cairo_format_t.CAIRO_FORMAT_ARGB32,
      this.m_width,
      this.m_height,
    );
    const context = cairo_create(surface);

    // Set default settings for the buffer
    cairo_set_antialias(context, this.m_currentAntialiasingMode);

    // Use the same transformation matrix as the main context
    cairo_get_matrix(this.m_mainContext, this.m_matrix);
    cairo_set_matrix(context, this.m_matrix);

    // Store the new buffer
    const buffer: CAIRO_BUFFER = { context, surface };
    this.m_buffers.push(buffer);

    return this.usedBuffers();
  }

  /// @copydoc COMPOSITOR::GetBuffer()
  override GetBuffer(): number {
    return this.m_current + 1;
  }

  /// @copydoc COMPOSITOR::SetBuffer()
  override SetBuffer(aBufferHandle: number): void {
    wxASSERT(aBufferHandle <= this.usedBuffers(), 'Tried to use a not existing buffer');

    // Get currently used transformation matrix, so it can be applied to the new buffer
    cairo_get_matrix(this.m_currentContext.get(), this.m_matrix);

    this.m_current = aBufferHandle - 1;
    this.m_currentContext.set(this.m_buffers[this.m_current]!.context);

    // Apply the current transformation matrix
    cairo_set_matrix(this.m_currentContext.get(), this.m_matrix);
  }

  /// @copydoc COMPOSITOR::Begin()
  override Begin(): void {}

  /// @copydoc COMPOSITOR::ClearBuffer()
  override ClearBuffer(aColor: Color4d): void {
    // Clear the pixel storage: memset( bitmap, 0x00, m_bufferSize )
    const buffer = this.m_buffers[this.m_current]!;
    const ctx = buffer.surface.backing.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, buffer.surface.width, buffer.surface.height);
  }

  /**
   * @copydoc COMPOSITOR::DrawBuffer(), and the three-argument overload:
   *
   * Paints source to destination using the cairo operator. Useful for differential mode.
   *
   * @param aSourceHandle Source buffer to paint
   * @param aDestHandle Destination buffer to paint on to
   * @param op Painting operation
   */
  override DrawBuffer(aBufferHandle: number): void;
  override DrawBuffer(aSourceHandle: number, aDestHandle: number, op: cairo_operator_t): void;
  override DrawBuffer(aSourceHandle: number, aDestHandle?: number, op?: cairo_operator_t): void {
    if (aDestHandle === undefined) {
      const aBufferHandle = aSourceHandle;
      wxASSERT(aBufferHandle <= this.usedBuffers(), 'Tried to use a not existing buffer');

      // Reset the transformation matrix, so it is possible to composite images using
      // screen coordinates instead of world coordinates
      cairo_get_matrix(this.m_mainContext, this.m_matrix);
      cairo_identity_matrix(this.m_mainContext);

      // Draw the selected buffer contents
      cairo_set_source_surface(
        this.m_mainContext,
        this.m_buffers[aBufferHandle - 1]!.surface,
        0.0,
        0.0,
      );
      cairo_paint(this.m_mainContext);

      // Restore the transformation matrix
      cairo_set_matrix(this.m_mainContext, this.m_matrix);
      return;
    }

    wxASSERT(
      aSourceHandle <= this.usedBuffers() && aDestHandle <= this.usedBuffers(),
      'Tried to use a not existing buffer',
    );

    // Reset the transformation matrix, so it is possible to composite images using
    // screen coordinates instead of world coordinates
    cairo_get_matrix(this.m_mainContext, this.m_matrix);
    cairo_identity_matrix(this.m_mainContext);

    // Draw the selected buffer contents
    const ct = cairo_create(this.m_buffers[aDestHandle - 1]!.surface);
    cairo_set_operator(ct, op ?? cairo_operator_t.CAIRO_OPERATOR_OVER);
    cairo_set_source_surface(ct, this.m_buffers[aSourceHandle - 1]!.surface, 0.0, 0.0);
    cairo_paint(ct);
    cairo_destroy(ct);

    // Restore the transformation matrix
    cairo_set_matrix(this.m_mainContext, this.m_matrix);
  }

  /// @copydoc COMPOSITOR::Present()
  override Present(): void {}

  /**
   * Set a context to be treated as the main context (ie. as a target of buffers rendering and
   * as a source of settings for newly created buffers).
   *
   * @param aMainContext is the context that should be treated as the main one.
   */
  SetMainContext(aMainContext: cairo_t): void {
    this.m_mainContext = aMainContext;

    // Use the context's transformation matrix
    cairo_get_matrix(this.m_mainContext, this.m_matrix);
  }

  /**
   * Perform freeing of resources.
   */
  protected clean(): void {
    for (const it of this.m_buffers) {
      cairo_destroy(it.context);
      cairo_surface_destroy(it.surface);
    }

    this.m_buffers = [];
  }

  /// Return number of currently used buffers.
  protected usedBuffers(): number {
    return this.m_buffers.length;
  }
}
