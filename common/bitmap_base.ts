// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/bitmap_base.h` / `common/bitmap_base.cpp`: `BITMAP_BASE`, the
 * image an `SCH_BITMAP` / `PCB_REFERENCE_IMAGE` carries — the decoded pixels
 * (`m_image`), the untransformed original, the encoded bytes as read from the
 * file (`m_imageData`, cleared by a transform and re-encoded on save), the
 * resolution and the scale.
 *
 * Not here: `DrawBitmap( wxDC* )`, the wxDC drawing path, and the cached
 * `wxBitmap` it draws (`m_bitmap` / `m_bitmapDirty` / `rebuildBitmap`), which
 * exist for wx only; the OpenGL painter reads `m_image` and `m_imageId`.
 */

import type { Color4d } from './color4d.js';
import { type KIID, newKiid } from './kiid.js';
import { FLIP_DIRECTION } from '@ziroeda/core/mirror.js';
import { ANGLE_0, ANGLE_90, type EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import {
  WX_IMAGE,
  wxBitmapType,
  wxIMAGE_OPTION_RESOLUTIONUNIT,
  wxIMAGE_OPTION_RESOLUTIONX,
  wxIMAGE_OPTION_RESOLUTIONY,
  wxImageResolution,
} from './wx_image.js';

/** The `PLOTTER` members `PlotImage` reaches. -- PLOTTER class pending (#636 stage 4) */
export interface PLOTTER_FOR_IMAGE {
  SetColor(aColor: Color4d): void;
  SetCurrentLineWidth(aWidth: number): void;
  PlotImage(aImage: WX_IMAGE, aPos: VECTOR2I, aScaleFactor: number): void;
}

/**
 * This class handle bitmap images in KiCad.
 *
 * It is not intended to be used alone, but inside another class so all methods are protected
 * or private and are accessible only from the derived classes.  Accessors are only
 * needed from the derived classes.
 */
export class BITMAP_BASE {
  private m_scale: number; ///< The scaling factor of the bitmap with #m_pixelSizeIu, controls the actual draw size.
  private m_imageData: Uint8Array | null; ///< Cached encoded image data (PNG/JPEG).
  private m_imageType: wxBitmapType; ///< The image type (png, jpeg, etc.).
  private m_image: WX_IMAGE | null; ///< The raw, uncompressed image data.
  private m_originalImage: WX_IMAGE | null; ///< Raw image data, not transformed by rotate/mirror.
  private m_pixelSizeIu: number; ///< The scaling factor of the bitmap to convert the bitmap size (in pixels) to internal KiCad units.
  private m_ppi: number; ///< The bitmap definition. The default is 300PPI.
  private m_imageId: KIID;
  private m_isMirroredX: boolean; // Used for OpenGL rendering only
  private m_isMirroredY: boolean; // Used for OpenGL rendering only
  private m_rotation: EDA_ANGLE; // Used for OpenGL rendering only

  constructor();
  constructor(aPos: VECTOR2I);
  constructor(aSchBitmap: BITMAP_BASE);
  constructor(a?: VECTOR2I | BITMAP_BASE) {
    if (a instanceof BITMAP_BASE) {
      const aSchBitmap = a;
      this.m_scale = aSchBitmap.m_scale;
      this.m_ppi = aSchBitmap.m_ppi;
      this.m_pixelSizeIu = aSchBitmap.m_pixelSizeIu;
      this.m_isMirroredX = aSchBitmap.m_isMirroredX;
      this.m_isMirroredY = aSchBitmap.m_isMirroredY;
      this.m_rotation = aSchBitmap.m_rotation.Clone();
      this.m_imageType = aSchBitmap.m_imageType;
      this.m_image = null;
      this.m_originalImage = null;
      this.m_imageData = null;
      this.m_imageId = newKiid();

      if (aSchBitmap.m_image) {
        this.m_image = new WX_IMAGE(aSchBitmap.m_image);
        this.m_originalImage = new WX_IMAGE(aSchBitmap.m_originalImage!);
        this.m_imageType = aSchBitmap.m_imageType;
        this.m_imageData = aSchBitmap.m_imageData ? new Uint8Array(aSchBitmap.m_imageData) : null;
        this.m_imageId = aSchBitmap.m_imageId;
      }

      return;
    }

    this.m_scale = 1.0; // 1.0 = original bitmap size
    this.m_imageType = wxBitmapType.wxBITMAP_TYPE_INVALID;
    this.m_image = null;
    this.m_originalImage = null;
    this.m_imageData = null;
    this.m_ppi = 300; // the bitmap definition. the default is 300PPI
    this.m_pixelSizeIu = 254000.0 / this.m_ppi; // a pixel size value OK for bitmaps using 300 PPI
    // for Eeschema which uses currently 254000PPI
    this.m_isMirroredX = false;
    this.m_isMirroredY = false;
    this.m_rotation = ANGLE_0.Clone();
    this.m_imageId = newKiid();
  }

  /*
   * Accessors:
   */
  GetPixelSizeIu(): number {
    return this.m_pixelSizeIu;
  }
  SetPixelSizeIu(aPixSize: number): void {
    this.m_pixelSizeIu = aPixSize;
  }

  GetImageData(): WX_IMAGE | null {
    return this.m_image;
  }
  GetOriginalImageData(): WX_IMAGE | null {
    return this.m_originalImage;
  }

  GetScale(): number {
    return this.m_scale;
  }
  SetScale(aScale: number): void {
    this.m_scale = aScale;
  }

  GetImageID(): KIID {
    return this.m_imageId;
  }

  /**
   * Copy aItem image to this object and update #m_bitmap.
   */
  ImportData(aItem: BITMAP_BASE): void {
    this.m_image = aItem.m_image ? new WX_IMAGE(aItem.m_image) : null;
    this.m_originalImage = aItem.m_originalImage ? new WX_IMAGE(aItem.m_originalImage) : null;
    this.m_imageId = aItem.m_imageId;
    this.m_scale = aItem.m_scale;
    this.m_ppi = aItem.m_ppi;
    this.m_pixelSizeIu = aItem.m_pixelSizeIu;
    this.m_isMirroredX = aItem.m_isMirroredX;
    this.m_isMirroredY = aItem.m_isMirroredY;
    this.m_rotation = aItem.m_rotation.Clone();
    this.m_imageType = aItem.m_imageType;
    this.m_imageData = aItem.m_imageData ? new Uint8Array(aItem.m_imageData) : null;
  }

  /**
   * This scaling factor depends on #m_pixelSizeIu and #m_scale.
   *
   * #m_pixelSizeIu gives the scaling factor between a pixel size and the internal units.
   * #m_scale is an user dependent value, and gives the "zoom" value.
   *  - #m_scale = 1.0 = original size of bitmap.
   *  - #m_scale < 1.0 = the bitmap is drawn smaller than its original size.
   *  - #m_scale > 1.0 = the bitmap is drawn bigger than its original size.
   *
   * @return The scaling factor from pixel size to actual draw size.
   */
  GetScalingFactor(): number {
    return this.m_pixelSizeIu * this.m_scale;
  }

  /**
   * @return the actual size (in user units, not in pixels) of the image
   */
  GetSize(): VECTOR2I {
    const size: VECTOR2I = { x: 0, y: 0 };

    if (this.m_image) {
      size.x = KiROUND(this.m_image.GetWidth() * this.GetScalingFactor());
      size.y = KiROUND(this.m_image.GetHeight() * this.GetScalingFactor());
    }

    return size;
  }

  /**
   * @return the size in pixels of the image
   */
  GetSizePixels(): VECTOR2I {
    if (this.m_image) return { x: this.m_image.GetWidth(), y: this.m_image.GetHeight() };
    else return { x: 0, y: 0 };
  }

  /**
   * @return the bitmap definition in ppi, the default is 300 ppi.
   */
  GetPPI(): number {
    return this.m_ppi;
  }

  /**
   * Return the orthogonal, bounding box of this object for display purposes.
   *
   * This box should be an enclosing perimeter for visible components of this object,
   * and the units should be in the pcb or schematic coordinate system.  It is OK to
   * overestimate the size by a few counts.
   */
  GetBoundingBox(): BOX2I {
    const bbox = new BOX2I();
    const size = this.GetSize();

    bbox.Inflate(Math.trunc(size.x / 2), Math.trunc(size.y / 2));

    return bbox;
  }

  /**
   * Reads and stores in memory an image file.
   *
   * Initialize the bitmap format used to draw this item.
   *
   * Supported images formats are format supported by wxImage if all handlers are loaded.
   * By default, .png, .jpeg are always loaded.
   *
   * @param aBuf a memory buffer containing the file data.
   * @return true if success reading else false.
   */
  ReadImageFile(aBuf: Uint8Array): boolean {
    // Store the original image data in m_imageData
    this.m_imageData = new Uint8Array(aBuf);

    const new_image = new WX_IMAGE();

    // Load the image from the buffer into new_image
    if (!new_image.LoadFile(this.m_imageData)) return false;

    // wxImage::LoadFile( stream, wxBITMAP_TYPE_ANY ) leaves the detected type with the handler;
    // SaveImageData keys on JPEG vs everything else.
    this.m_imageType = WX_IMAGE.DetectType(this.m_imageData);

    return this.SetImage(new_image);
  }

  /**
   * Set the image from an existing wxImage.
   */
  SetImage(aImage: WX_IMAGE): boolean {
    if (!aImage.IsOk() || aImage.GetWidth() === 0 || aImage.GetHeight() === 0) return false;

    this.m_image = new WX_IMAGE(aImage);

    // Create a new wxImage object from m_image
    this.m_originalImage = new WX_IMAGE(this.m_image);

    this.rebuildBitmap();
    this.updatePPI();

    return true;
  }

  /**
   * Write the bitmap data to \a aOutStream.
   *
   * This writes binary data, not hexadecimal strings
   *
   * @return the bytes, or null when the image could not be encoded.
   */
  SaveImageData(): Uint8Array | null {
    if (!this.m_imageData || this.m_imageData.length === 0) {
      // If m_imageData is empty, use wxImage::Save() method to write m_image contents to
      // the stream.
      if (this.m_imageType === wxBitmapType.wxBITMAP_TYPE_JPEG) {
        // wxImage::SaveFile( stream, wxBITMAP_TYPE_JPEG ): no JPEG encoder here.
        return null;
      }

      return this.m_image ? this.m_image.SaveFilePng() : null;
    } else {
      // Write the contents of m_imageData to the stream.
      return this.m_imageData;
    }
  }

  /**
   * Load an image data saved by #SaveData.
   *
   * The file format must be png format in hexadecimal.
   *
   * @param aLines the lines of the data block, up to and including "EndData".
   * @return true if the bitmap loaded successfully, else the error message.
   */
  LoadLegacyData(aLines: Iterator<string>): { ok: boolean; errorMsg: string } {
    const bytes: number[] = [];

    for (;;) {
      const next = aLines.next();

      if (next.done) return { ok: false, errorMsg: 'Unexpected end of data' };

      let line = next.value;

      if (line.slice(0, 4).toLowerCase() === 'endd') {
        // all the PNG date is read.
        // We expect here m_image and m_bitmap are void
        this.m_image = new WX_IMAGE();
        this.m_image.LoadFile(Uint8Array.from(bytes));
        this.m_originalImage = new WX_IMAGE(this.m_image);
        this.updateImageDataBuffer();
        break;
      }

      // Read PNG data, stored in hexadecimal,
      // each byte = 2 hexadecimal digits and a space between 2 bytes
      // and put it in memory stream buffer
      let len = line.length;

      for (; len > 0; len -= 3, line = line.slice(3)) {
        const value = Number.parseInt(line.slice(0, 2), 16);

        if (!Number.isNaN(value)) bytes.push(value & 0xff);
        else break;
      }
    }

    return { ok: true, errorMsg: '' };
  }

  /**
   * Mirror image vertically (i.e. relative to its horizontal X axis ) or horizontally (i.e
   * relative to its vertical Y axis).
   * @param aFlipDirection the direction to flip the image.
   */
  Mirror(aFlipDirection: FLIP_DIRECTION): void {
    if (this.m_image) {
      BITMAP_BASE.mirrorImageInPlace(this.m_image, aFlipDirection);

      if (aFlipDirection === FLIP_DIRECTION.TOP_BOTTOM) this.m_isMirroredY = !this.m_isMirroredY;
      else this.m_isMirroredX = !this.m_isMirroredX;

      this.m_imageData = null;
    }
  }

  /**
   * Rotate image CW or CCW.
   *
   * @param aRotateCCW true to rotate CCW or false to rotate CW.
   */
  Rotate(aRotateCCW: boolean): void {
    if (this.m_image) {
      // wxImage::Rotate90() clears resolution metadata, so preserve it
      const resX = this.m_image.GetOptionInt(wxIMAGE_OPTION_RESOLUTIONX);
      const resY = this.m_image.GetOptionInt(wxIMAGE_OPTION_RESOLUTIONY);
      const unit = this.m_image.GetOptionInt(wxIMAGE_OPTION_RESOLUTIONUNIT);

      // wxImage::Rotate90 parameter is "clockwise", so invert for CCW rotation
      this.m_image = this.m_image.Rotate90(!aRotateCCW);

      this.m_image.SetOption(wxIMAGE_OPTION_RESOLUTIONUNIT, unit);
      this.m_image.SetOption(wxIMAGE_OPTION_RESOLUTIONX, resX);
      this.m_image.SetOption(wxIMAGE_OPTION_RESOLUTIONY, resY);

      this.m_rotation = this.m_rotation.add(aRotateCCW ? ANGLE_90 : ANGLE_90.negate());
      this.m_imageData = null;
    }
  }

  ConvertToGreyscale(): void {
    if (this.m_image) {
      this.m_image = this.m_image.ConvertToGreyscale();
      this.m_originalImage = this.m_originalImage!.ConvertToGreyscale();
      this.m_imageData = null;
      this.m_imageId = newKiid();
    }
  }

  IsMirroredX(): boolean {
    return this.m_isMirroredX;
  }
  IsMirroredY(): boolean {
    return this.m_isMirroredY;
  }
  Rotation(): EDA_ANGLE {
    return this.m_rotation;
  }

  /**
   * Plot bitmap on plotter.
   *
   * If the plotter does not support bitmaps, plot a
   *
   * @param aPlotter the plotter to use.
   * @param aPos the position of the center of the bitmap.
   * @param aDefaultColor the color used to plot the rectangle when bitmap is not supported.
   * @param aDefaultPensize the pen size used to plot the rectangle when bitmap is not supported.
   */
  PlotImage(
    aPlotter: PLOTTER_FOR_IMAGE,
    aPos: VECTOR2I,
    aDefaultColor: Color4d,
    aDefaultPensize: number,
  ): void {
    if (this.m_image === null) return;

    // These 2 lines are useful only for plotters that cannot plot a bitmap
    // and plot a rectangle instead of.
    aPlotter.SetColor(aDefaultColor);
    aPlotter.SetCurrentLineWidth(aDefaultPensize);

    aPlotter.PlotImage(this.m_image, aPos, this.GetScalingFactor());
  }

  /**
   * Return the bitmap type (png, jpeg, etc.)
   */
  GetImageType(): wxBitmapType {
    return this.m_imageType;
  }

  /**
   * Set the bitmap type (png, jpeg, etc.)
   */
  SetImageType(aType: wxBitmapType): void {
    this.m_imageType = aType;
  }

  /**
   * Resets the image data buffer using the current image data.
   */
  private updateImageDataBuffer(): void {
    if (this.m_image) {
      if (this.m_imageType === wxBitmapType.wxBITMAP_TYPE_JPEG) return; // no JPEG encoder here

      const bytes = this.m_image.SaveFilePng();

      if (!bytes) return;

      this.m_imageData = bytes;
    }
  }

  /**
   * Rebuild the internal bitmap used to draw/plot image.
   *
   * This must be called after a #m_image change.
   *
   * @param aResetID is used to reset the cache ID used for OpenGL rendering.
   */
  private rebuildBitmap(aResetID = true): void {
    if (aResetID) this.m_imageId = newKiid();
  }

  private updatePPI(): void {
    // Todo: eventually we need to support dpi / scaling in both dimensions
    const dpiX = this.m_originalImage!.GetOptionInt(wxIMAGE_OPTION_RESOLUTIONX);

    if (dpiX > 1) {
      if (
        this.m_originalImage!.GetOptionInt(wxIMAGE_OPTION_RESOLUTIONUNIT) ===
        wxImageResolution.wxIMAGE_RESOLUTION_CM
      )
        this.m_ppi = KiROUND(dpiX * 2.54);
      else this.m_ppi = dpiX;
    }
  }

  /**
   * Mirror the wxImage pixel data in-place without allocating a new image.
   */
  private static mirrorImageInPlace(aImage: WX_IMAGE, aFlipDirection: FLIP_DIRECTION): void {
    const w = aImage.GetWidth();
    const h = aImage.GetHeight();

    if (w === 0 || h === 0) return;

    const rgb = aImage.GetData();
    const alpha = aImage.HasAlpha() ? aImage.GetAlpha() : null;
    const bpp = 3;

    if (!rgb) throw new Error('BITMAP_BASE::Mirror: the pixels are not decoded');

    if (aFlipDirection === FLIP_DIRECTION.LEFT_RIGHT) {
      // Swap columns left-to-right within each row
      for (let y = 0; y < h; ++y) {
        const rowRgb = y * w * bpp;

        for (let lo = 0, hi = w - 1; lo < hi; ++lo, --hi) {
          for (let c = 0; c < 3; c++) {
            const t = rgb[rowRgb + lo * bpp + c]!;
            rgb[rowRgb + lo * bpp + c] = rgb[rowRgb + hi * bpp + c]!;
            rgb[rowRgb + hi * bpp + c] = t;
          }
        }

        if (alpha) {
          const rowAlpha = y * w;

          for (let lo = 0, hi = w - 1; lo < hi; ++lo, --hi) {
            const t = alpha[rowAlpha + lo]!;
            alpha[rowAlpha + lo] = alpha[rowAlpha + hi]!;
            alpha[rowAlpha + hi] = t;
          }
        }
      }
    } else {
      // Swap entire rows top-to-bottom
      const rowBytes = w * bpp;
      const tmpRgb = new Uint8Array(rowBytes);

      for (let lo = 0, hi = h - 1; lo < hi; ++lo, --hi) {
        tmpRgb.set(rgb.subarray(lo * rowBytes, lo * rowBytes + rowBytes));
        rgb.copyWithin(lo * rowBytes, hi * rowBytes, hi * rowBytes + rowBytes);
        rgb.set(tmpRgb, hi * rowBytes);
      }

      if (alpha) {
        const tmpAlpha = new Uint8Array(w);

        for (let lo = 0, hi = h - 1; lo < hi; ++lo, --hi) {
          tmpAlpha.set(alpha.subarray(lo * w, lo * w + w));
          alpha.copyWithin(lo * w, hi * w, hi * w + w);
          alpha.set(tmpAlpha, hi * w);
        }
      }
    }
  }
}
