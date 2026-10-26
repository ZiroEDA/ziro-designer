// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The part of `wxImage` that `BITMAP_BASE` uses: an RGB plane, an optional
 * alpha plane, a mask colour, the resolution options, `LoadFile` for the
 * handlers `wxInitAllImageHandlers` registers that KiCad's image dialogs
 * offer (BMP, PNG, JPEG, GIF), `SaveFile` for PNG and JPEG, `Rotate90`,
 * `Mirror` and `ConvertToGreyscale`.
 *
 * BMP is wx's own reader (`imagbmp.ts`), GIF wx's own decoder
 * (`gifdecod.ts`, `imaggif.ts`), both read through a `wxMemoryInputStream`
 * as BITMAP_BASE reads. PNG is decoded here (every colour type, bit depth and
 * Adam7) and encoded with `imagpng.ts`. JPEG goes through `wxJPEGHandler`'s own libjpeg calls,
 * compiled with the libjpeg-turbo KiCad links (`jpeg/`), so its pixels, its
 * CMYK conversion and its re-encoding are the ones KiCad gets. That module is
 * instantiated once, asynchronously, by `wxInitAllImageHandlers` - as KiCad's
 * `PGM_BASE::InitPgm` registers the handlers before any image is read; until
 * then a JPEG has no handler and does not load, as in wx.
 *
 * wx's PNG handler turns a `pHYs` in metres into dots per centimetre with an
 * integer division (`resX /= 100`), which is what makes a 3937 px/m (100 dpi)
 * file read back as 39 dots/cm; `BITMAP_BASE::updatePPI` then rounds
 * `39 * 2.54` to 99. That path is kept as it is.
 */

import { inflateZlib } from './inflate.js';
import { zlibSync } from 'fflate';
import { PNG_SIGNATURE, pngChunk, pngCrc32 } from './imagpng.js';
import type { IMAGJPEG_MODULE } from './jpeg/imagjpeg_wasm.js';
import { wxMemoryInputStream } from './mstream.js';
import { wxGIFHandlerCanRead, wxGIFHandlerLoadFile } from './imaggif.js';
import { wxBMPHandlerLoadFile } from './imagbmp.js';

/** `wxImageResolution`. */
export enum wxImageResolution {
  wxIMAGE_RESOLUTION_NONE = 0,
  wxIMAGE_RESOLUTION_INCHES = 1,
  wxIMAGE_RESOLUTION_CM = 2,
}

/** `wxBitmapType`, the members the image code uses. */
export enum wxBitmapType {
  wxBITMAP_TYPE_INVALID = 0,
  wxBITMAP_TYPE_BMP = 1,
  wxBITMAP_TYPE_PNG = 15,
  wxBITMAP_TYPE_GIF = 13,
  wxBITMAP_TYPE_JPEG = 17,
  wxBITMAP_TYPE_ANY = 50,
}

export const wxIMAGE_OPTION_RESOLUTIONX = 'ResolutionX';
export const wxIMAGE_OPTION_RESOLUTIONY = 'ResolutionY';
export const wxIMAGE_OPTION_RESOLUTIONUNIT = 'ResolutionUnit';
export const wxIMAGE_OPTION_RESOLUTION = 'Resolution';
export const wxIMAGE_OPTION_QUALITY = 'quality';

/** wxJPEGHandler's libjpeg, once `wxInitAllImageHandlers` has instantiated it. */
let s_jpeg: IMAGJPEG_MODULE | null = null;
let s_jpegInit: Promise<void> | null = null;

/**
 * `wxInitAllImageHandlers`: register the image handlers. Only the JPEG one needs
 * work - instantiating its WebAssembly - and a browser will not do that
 * synchronously, so this is the one image call to await. Idempotent.
 *
 * Imported here rather than at the top: libjpeg is ~130 kB gzipped, and as a chunk
 * of its own it loads beside the app instead of inside its first bundle.
 */
export function wxInitAllImageHandlers(): Promise<void> {
  s_jpegInit ??= import('./jpeg/imagjpeg_wasm.js')
    .then(({ default: createImagJpeg }) => createImagJpeg())
    .then((aModule) => {
      s_jpeg = aModule;
    });

  return s_jpegInit;
}

/**
 * `wxImageHandler::GetResolutionFromOptions` (image.cpp:3486): the resolution
 * X and Y options, or the single Resolution one, and their unit - inches when
 * none is given.
 */
function GetResolutionFromOptions(aImage: WX_IMAGE): {
  unit: wxImageResolution;
  x: number;
  y: number;
} {
  let x: number;
  let y: number;

  if (
    aImage.HasOption(wxIMAGE_OPTION_RESOLUTIONX) &&
    aImage.HasOption(wxIMAGE_OPTION_RESOLUTIONY)
  ) {
    x = aImage.GetOptionInt(wxIMAGE_OPTION_RESOLUTIONX);
    y = aImage.GetOptionInt(wxIMAGE_OPTION_RESOLUTIONY);
  } else if (aImage.HasOption(wxIMAGE_OPTION_RESOLUTION)) {
    x = y = aImage.GetOptionInt(wxIMAGE_OPTION_RESOLUTION);
  } else {
    // no resolution options specified
    return { unit: wxImageResolution.wxIMAGE_RESOLUTION_NONE, x: 0, y: 0 };
  }

  // get the resolution unit too
  let resUnit = aImage.GetOptionInt(wxIMAGE_OPTION_RESOLUTIONUNIT);

  if (!resUnit) {
    // this is the default
    resUnit = wxImageResolution.wxIMAGE_RESOLUTION_INCHES;
  }

  return { unit: resUnit, x, y };
}

const be32 = (b: Uint8Array, off: number): number =>
  ((b[off]! << 24) | (b[off + 1]! << 16) | (b[off + 2]! << 8) | b[off + 3]!) >>> 0;

const put32 = (b: Uint8Array, off: number, v: number): void => {
  b[off] = (v >>> 24) & 0xff;
  b[off + 1] = (v >>> 16) & 0xff;
  b[off + 2] = (v >>> 8) & 0xff;
  b[off + 3] = v & 0xff;
};

/** `wxPNGHandler::DoCanRead`: four bytes, "\x89PNG" - libpng checks the rest when it loads. */
function canReadPng(aData: Uint8Array): boolean {
  if (aData.length < 4) return false;

  for (let i = 0; i < 4; i++) if (aData[i] !== PNG_SIGNATURE[i]) return false;

  return true;
}

/** `wxBMPHandler::DoCanRead`: `ReadAll` two bytes, "BM". */
function canReadBmp(aData: Uint8Array): boolean {
  return aData.length >= 2 && aData[0] === 0x42 && aData[1] === 0x4d;
}

/** `wxJPEGHandler::DoCanRead`: two bytes, FF D8 - not three. */
function canReadJpeg(aData: Uint8Array): boolean {
  return aData.length >= 2 && aData[0] === 0xff && aData[1] === 0xd8;
}

/** `wxImage`. */
export class WX_IMAGE {
  private m_width = 0;
  private m_height = 0;
  private m_rgb: Uint8Array | null = null; // 3 bytes per pixel, row-major
  private m_alpha: Uint8Array | null = null; // 1 byte per pixel, or none
  private m_options = new Map<string, number>();
  private m_type = wxBitmapType.wxBITMAP_TYPE_INVALID;
  private m_hasMask = false;
  private m_maskRed = 0;
  private m_maskGreen = 0;
  private m_maskBlue = 0;

  constructor();
  constructor(aWidth: number, aHeight: number);
  constructor(aOther: WX_IMAGE);
  constructor(a?: number | WX_IMAGE, aHeight?: number) {
    if (a instanceof WX_IMAGE) {
      this.m_width = a.m_width;
      this.m_height = a.m_height;
      this.m_rgb = a.m_rgb ? new Uint8Array(a.m_rgb) : null;
      this.m_alpha = a.m_alpha ? new Uint8Array(a.m_alpha) : null;
      this.m_options = new Map(a.m_options);
      this.m_type = a.m_type;
      this.m_hasMask = a.m_hasMask;
      this.m_maskRed = a.m_maskRed;
      this.m_maskGreen = a.m_maskGreen;
      this.m_maskBlue = a.m_maskBlue;
    } else if (a !== undefined) {
      this.m_width = a;
      this.m_height = aHeight!;
      this.m_rgb = new Uint8Array(a * aHeight! * 3);
    }
  }

  IsOk(): boolean {
    return this.m_width > 0 && this.m_height > 0;
  }
  GetWidth(): number {
    return this.m_width;
  }
  GetHeight(): number {
    return this.m_height;
  }
  HasAlpha(): boolean {
    return this.m_alpha !== null;
  }
  /** The RGB plane; null for an image that was never created or loaded. */
  GetData(): Uint8Array | null {
    return this.m_rgb;
  }
  /** `GetAlpha()`, the plane; `GetAlpha( x, y )`, one pixel's (0 with no plane, where wx asserts). */
  GetAlpha(): Uint8Array | null;
  GetAlpha(x: number, y: number): number;
  GetAlpha(x?: number, y?: number): Uint8Array | null | number {
    if (x === undefined || y === undefined) return this.m_alpha;
    return this.m_alpha ? this.m_alpha[y * this.m_width + x]! : 0;
  }
  /**
   * `wxImage::SetAlpha( nullptr )`: give the image an alpha plane for the
   * caller to fill (wx leaves it uninitialised; it is zero here).
   * `SetAlpha( alpha )`: take \a aPlane, one byte per pixel, as the plane.
   * `SetAlpha( x, y, alpha )`: one pixel's.
   */
  SetAlpha(aPlane?: Uint8Array): void;
  SetAlpha(x: number, y: number, aAlpha: number): void;
  SetAlpha(x?: number | Uint8Array, y?: number, aAlpha?: number): void {
    if (x instanceof Uint8Array) {
      this.m_alpha = x;
      return;
    }
    if (x === undefined || y === undefined) {
      this.m_alpha = new Uint8Array(this.m_width * this.m_height);
      return;
    }
    if (this.m_alpha) this.m_alpha[y * this.m_width + x] = aAlpha! & 0xff;
  }
  /**
   * `wxImage::SetData( data, new_width, new_height )`: \a aRgb, 3 bytes per pixel, becomes the
   * image. wx gives the image fresh data, so the alpha plane and the options go with the old.
   */
  SetData(aRgb: Uint8Array, aWidth: number, aHeight: number): void {
    this.m_width = aWidth;
    this.m_height = aHeight;
    this.m_rgb = aRgb;
    this.m_alpha = null;
    this.m_options = new Map();
    this.m_hasMask = false;
  }

  /** `wxImage::Create( width, height )`: a black image, no alpha, no mask, no options. */
  Create(aWidth: number, aHeight: number): boolean {
    // wxCHECK_MSG( width > 0 && height > 0 ), and a malloc that fails
    if (!(aWidth > 0 && aHeight > 0)) return false;

    let rgb: Uint8Array;

    try {
      rgb = new Uint8Array(aWidth * aHeight * 3);
    } catch {
      return false;
    }

    this.SetData(rgb, aWidth, aHeight);
    return this.IsOk();
  }

  /** `wxImage::ClearAlpha`: no alpha plane. */
  ClearAlpha(): void {
    this.m_alpha = null;
  }

  HasMask(): boolean {
    return this.m_hasMask;
  }
  /** `wxImage::SetMask( hasMask )`. */
  SetMask(aMask = true): void {
    this.m_hasMask = aMask;
  }
  /** `wxImage::SetMaskColour( r, g, b )`: the colour that is transparent, and a mask on. */
  SetMaskColour(aRed: number, aGreen: number, aBlue: number): void {
    this.m_maskRed = aRed;
    this.m_maskGreen = aGreen;
    this.m_maskBlue = aBlue;
    this.m_hasMask = true;
  }
  GetMaskRed(): number {
    return this.m_maskRed;
  }
  GetMaskGreen(): number {
    return this.m_maskGreen;
  }
  GetMaskBlue(): number {
    return this.m_maskBlue;
  }

  /** `wxImage::MakeEmptyClone`'s share of a copy: the mask colour, when there is one. */
  private copyMaskTo(aImage: WX_IMAGE): WX_IMAGE {
    if (this.m_hasMask) aImage.SetMaskColour(this.m_maskRed, this.m_maskGreen, this.m_maskBlue);
    return aImage;
  }
  /**
   * `wxImage::Mirror( horizontally )`: a copy flipped left to right, or with \a aHorizontally
   * false, top to bottom; the alpha plane is flipped with it.
   */
  Mirror(aHorizontally = true): WX_IMAGE {
    const w = this.m_width;
    const h = this.m_height;
    const image = new WX_IMAGE(w, h);
    const src = this.m_rgb!;
    const dst = image.m_rgb!;

    if (this.m_alpha) image.m_alpha = new Uint8Array(w * h);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const tx = aHorizontally ? w - 1 - x : x;
        const ty = aHorizontally ? y : h - 1 - y;
        const s = y * w + x;
        const d = ty * w + tx;

        dst[d * 3] = src[s * 3]!;
        dst[d * 3 + 1] = src[s * 3 + 1]!;
        dst[d * 3 + 2] = src[s * 3 + 2]!;

        if (this.m_alpha) image.m_alpha![d] = this.m_alpha[s]!;
      }
    }

    return this.copyMaskTo(image);
  }
  /** `wxImage::GetRed( x, y )`. */
  GetRed(x: number, y: number): number {
    return this.m_rgb ? this.m_rgb[(y * this.m_width + x) * 3]! : 0;
  }
  /** `wxImage::GetGreen( x, y )`. */
  GetGreen(x: number, y: number): number {
    return this.m_rgb ? this.m_rgb[(y * this.m_width + x) * 3 + 1]! : 0;
  }
  /** `wxImage::GetBlue( x, y )`. */
  GetBlue(x: number, y: number): number {
    return this.m_rgb ? this.m_rgb[(y * this.m_width + x) * 3 + 2]! : 0;
  }
  /** `wxImage::SetRGB( x, y, r, g, b )`. */
  SetRGB(x: number, y: number, r: number, g: number, b: number): void {
    if (!this.m_rgb) return;
    const i = (y * this.m_width + x) * 3;
    this.m_rgb[i] = r & 0xff;
    this.m_rgb[i + 1] = g & 0xff;
    this.m_rgb[i + 2] = b & 0xff;
  }
  /**
   * `wxImage::Rescale( width, height )` at the default `wxIMAGE_QUALITY_NORMAL`,
   * i.e. `*this = Scale( ... )` through `ResampleNearest`: 16.16 fixed-point
   * steps of `(old << 16) / new`, each target pixel taking the source pixel at
   * the step's integer part (wx 3.2's image.cpp). The resolution options stay.
   */
  Rescale(aWidth: number, aHeight: number): this {
    const oldW = this.m_width;
    const oldH = this.m_height;
    if (!this.m_rgb || aWidth <= 0 || aHeight <= 0 || (oldW === aWidth && oldH === aHeight))
      return this;
    const rgb = new Uint8Array(aWidth * aHeight * 3);
    const alpha = this.m_alpha ? new Uint8Array(aWidth * aHeight) : null;
    const xDelta = Math.floor((oldW * 65536) / aWidth);
    const yDelta = Math.floor((oldH * 65536) / aHeight);
    let y = 0;
    let d = 0;
    let da = 0;
    for (let j = 0; j < aHeight; j++) {
      const srcRow = Math.floor(y / 65536) * oldW;
      let x = 0;
      for (let i = 0; i < aWidth; i++) {
        const src = srcRow + Math.floor(x / 65536);
        rgb[d++] = this.m_rgb[src * 3]!;
        rgb[d++] = this.m_rgb[src * 3 + 1]!;
        rgb[d++] = this.m_rgb[src * 3 + 2]!;
        if (alpha) alpha[da++] = this.m_alpha![src]!;
        x += xDelta;
      }
      y += yDelta;
    }
    this.m_width = aWidth;
    this.m_height = aHeight;
    this.m_rgb = rgb;
    this.m_alpha = alpha;
    return this;
  }
  GetOptionInt(aName: string): number {
    return this.m_options.get(aName) ?? 0;
  }
  SetOption(aName: string, aValue: number): void {
    this.m_options.set(aName, aValue);
  }
  HasOption(aName: string): boolean {
    return this.m_options.has(aName);
  }

  /**
   * `wxImage::LoadFile( stream, wxBITMAP_TYPE_ANY )`: each handler in `wxInitAllImageHandlers`'
   * order - BMP (built in), PNG, JPEG, GIF - is asked `CanRead`, and the first that can read the
   * stream and loads it wins. A handler that accepts the signature but fails to load passes the
   * stream on to the next (`handler->CanRead( stream ) && DoLoad( ... )`).
   */
  LoadFile(aData: Uint8Array): boolean {
    const handlers: [
      wxBitmapType,
      (aData: Uint8Array) => boolean,
      (aData: Uint8Array) => boolean,
    ][] = [
      [
        wxBitmapType.wxBITMAP_TYPE_BMP,
        canReadBmp,
        (d) => wxBMPHandlerLoadFile(this, new wxMemoryInputStream(d)),
      ],
      [wxBitmapType.wxBITMAP_TYPE_PNG, canReadPng, (d) => this.loadPng(d)],
      [wxBitmapType.wxBITMAP_TYPE_JPEG, canReadJpeg, (d) => this.loadJpeg(d)],
      [
        wxBitmapType.wxBITMAP_TYPE_GIF,
        (d) => wxGIFHandlerCanRead(new wxMemoryInputStream(d)),
        (d) => wxGIFHandlerLoadFile(this, new wxMemoryInputStream(d), -1),
      ],
    ];

    for (const [type, canRead, load] of handlers) {
      if (canRead(aData) && load(aData)) {
        // wxImage::DoLoad: m_refData->m_type = handler.GetType()
        this.m_type = type;
        return true;
      }
    }

    // "Unknown image data format."
    return false;
  }

  /** `wxImage::GetType`: the type of the handler that loaded it, or INVALID. */
  GetType(): wxBitmapType {
    return this.m_type;
  }

  /**
   * `wxImage::SaveFile( wxOutputStream&, wxBITMAP_TYPE_JPEG )` (imagjpeg.cpp:400):
   * libjpeg's defaults, the quality option when there is one, and the
   * resolution options as the JFIF density. The alpha plane is not written.
   */
  SaveFileJpeg(): Uint8Array | null {
    const jpeg = s_jpeg;

    if (!jpeg || !this.IsOk() || !this.m_rgb) return null;

    const quality = this.HasOption(wxIMAGE_OPTION_QUALITY)
      ? this.GetOptionInt(wxIMAGE_OPTION_QUALITY)
      : -1;
    const res = GetResolutionFromOptions(this);
    const ptr = jpeg._wxjpeg_alloc(this.m_rgb.length);
    jpeg.HEAPU8.set(this.m_rgb, ptr);

    const ok =
      jpeg._wxjpeg_save(ptr, this.m_width, this.m_height, quality, res.unit, res.x, res.y) === 1;

    jpeg._wxjpeg_free(ptr);

    if (!ok) return null;

    const data = jpeg._wxjpeg_data();
    const out = jpeg.HEAPU8.slice(data, data + jpeg._wxjpeg_size());

    jpeg._wxjpeg_release();

    return out;
  }

  /**
   * `wxImage::SaveFile( wxOutputStream&, wxBITMAP_TYPE_PNG )`: RGB, or RGBA
   * when there is an alpha plane, with the resolution as a `pHYs`.
   */
  SaveFilePng(): Uint8Array | null {
    if (!this.IsOk() || !this.m_rgb) return null;

    const w = this.m_width;
    const h = this.m_height;
    // bUseAlpha: an alpha plane, or a mask, which the RGBA rows carry as alpha 0
    const useAlpha = this.m_alpha !== null || this.m_hasMask;
    const bpp = useAlpha ? 4 : 3;
    const stride = w * bpp;
    const raw = new Uint8Array(h * (stride + 1));

    for (let y = 0; y < h; y++) {
      const rowOff = y * (stride + 1);
      raw[rowOff] = 0; // filter None

      for (let x = 0; x < w; x++) {
        const s = (y * w + x) * 3;
        const d = rowOff + 1 + x * bpp;
        raw[d] = this.m_rgb[s]!;
        raw[d + 1] = this.m_rgb[s + 1]!;
        raw[d + 2] = this.m_rgb[s + 2]!;

        if (useAlpha) {
          let uchAlpha = this.m_alpha ? this.m_alpha[y * w + x]! : 255;

          if (
            this.m_hasMask &&
            this.m_rgb[s] === this.m_maskRed &&
            this.m_rgb[s + 1] === this.m_maskGreen &&
            this.m_rgb[s + 2] === this.m_maskBlue
          )
            uchAlpha = 0;

          raw[d + 3] = uchAlpha;
        }
      }
    }

    const ihdr = new Uint8Array(13);
    put32(ihdr, 0, w);
    put32(ihdr, 4, h);
    ihdr[8] = 8;
    ihdr[9] = useAlpha ? 6 : 2;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    const parts: Uint8Array[] = [Uint8Array.from(PNG_SIGNATURE), pngChunk('IHDR', ihdr)];

    // wxPNGHandler::SaveFile writes pHYs from the resolution options: inches
    // are converted to metres (x 39.3700787), centimetres x 100.
    if (this.HasOption(wxIMAGE_OPTION_RESOLUTIONX) || this.HasOption(wxIMAGE_OPTION_RESOLUTIONY)) {
      const unit = this.GetOptionInt(wxIMAGE_OPTION_RESOLUTIONUNIT);
      let resX = this.GetOptionInt(wxIMAGE_OPTION_RESOLUTIONX);
      let resY = this.GetOptionInt(wxIMAGE_OPTION_RESOLUTIONY);

      if (resX === 0) resX = resY;

      if (resY === 0) resY = resX;

      if (unit === wxImageResolution.wxIMAGE_RESOLUTION_INCHES) {
        resX = Math.round(resX * 39.3700787);
        resY = Math.round(resY * 39.3700787);
      } else {
        resX *= 100;
        resY *= 100;
      }

      const phys = new Uint8Array(9);
      put32(phys, 0, resX);
      put32(phys, 4, resY);
      phys[8] = 1;
      parts.push(pngChunk('pHYs', phys));
    }

    // libpng deflates the rows. wxPNGHandler sets a level only when the image carries
    // wxIMAGE_OPTION_PNG_COMPRESSION_LEVEL (from memory of wx 3.2's imagpng.cpp; no wx source is on
    // disk here), so it is libpng's Z_DEFAULT_COMPRESSION: zlib level 6. libpng also picks a filter
    // per row; ours stay None, so the bytes differ from wx's while the pixels do not.
    parts.push(pngChunk('IDAT', zlibSync(raw, { level: 6 })));
    parts.push(pngChunk('IEND', new Uint8Array(0)));

    let total = 0;

    for (const p of parts) total += p.length;

    const file = new Uint8Array(total);
    let off = 0;

    for (const p of parts) {
      file.set(p, off);
      off += p.length;
    }

    return file;
  }

  /** `wxImage::Rotate90( bool clockwise )`: a new image; the options are NOT carried over. */
  Rotate90(aClockwise = true): WX_IMAGE {
    const w = this.m_width;
    const h = this.m_height;
    const out = new WX_IMAGE(h, w);

    if (!this.m_rgb) throw new Error('wxImage::Rotate90: the pixels are not decoded');

    if (this.m_alpha) out.m_alpha = new Uint8Array(w * h);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // clockwise: the top row becomes the right column
        const dx = aClockwise ? h - 1 - y : y;
        const dy = aClockwise ? x : w - 1 - x;
        const s = (y * w + x) * 3;
        const d = (dy * h + dx) * 3;
        out.m_rgb![d] = this.m_rgb[s]!;
        out.m_rgb![d + 1] = this.m_rgb[s + 1]!;
        out.m_rgb![d + 2] = this.m_rgb[s + 2]!;

        if (this.m_alpha) out.m_alpha![dy * h + dx] = this.m_alpha[y * w + x]!;
      }
    }

    return this.copyMaskTo(out);
  }

  /**
   * `wxImage::ConvertToGreyscale( 0.299, 0.587, 0.114 )`: `wxColour::MakeGrey` on every pixel
   * but the mask colour's - `(wxByte)wxRound( luma )`, halves away from zero, as
   * `qa/probes/wximage_greyscale_probe.cpp` measured for all 2^24 colours.
   */
  ConvertToGreyscale(): WX_IMAGE {
    const out = new WX_IMAGE(this);

    if (!out.m_rgb) throw new Error('wxImage::ConvertToGreyscale: the pixels are not decoded');

    for (let i = 0; i < out.m_rgb.length; i += 3) {
      // DoMakeGrey: a masked pixel keeps its colour, so it stays transparent
      if (
        out.m_hasMask &&
        out.m_rgb[i] === out.m_maskRed &&
        out.m_rgb[i + 1] === out.m_maskGreen &&
        out.m_rgb[i + 2] === out.m_maskBlue
      )
        continue;

      const luma = 0.299 * out.m_rgb[i]! + 0.587 * out.m_rgb[i + 1]! + 0.114 * out.m_rgb[i + 2]!;
      const grey = Math.round(luma) & 0xff; // wxRound: luma >= 0, so halves go up
      out.m_rgb[i] = grey;
      out.m_rgb[i + 1] = grey;
      out.m_rgb[i + 2] = grey;
    }

    return out;
  }

  /**
   * `wxImage::ConvertToDisabled( brightness )`: `wxColour::MakeDisabled` on
   * every pixel - each channel `AlphaBlend( c, brightness, 0.4 )`, a
   * truncating cast of `0.4 c + 0.6 brightness`. Alpha is kept. Measured by
   * `qa/probes/convert_disabled_probe.cpp`.
   */
  ConvertToDisabled(aBrightness = 255): WX_IMAGE {
    const out = new WX_IMAGE(this);

    if (!out.m_rgb) throw new Error('wxImage::ConvertToDisabled: the pixels are not decoded');

    for (let i = 0; i < out.m_rgb.length; ++i)
      out.m_rgb[i] = Math.trunc(out.m_rgb[i]! * 0.4 + aBrightness * (1.0 - 0.4));

    return out;
  }

  /**
   * `wxJPEGHandler::LoadFile` (imagjpeg.cpp:226): libjpeg decodes to RGB (CMYK
   * through `wx_cmyk_to_rgb`), and a JFIF marker's density becomes the
   * resolution options, its unit as libjpeg numbers it - 0, "aspect ratio
   * only", included.
   */
  private loadJpeg(aData: Uint8Array): boolean {
    const jpeg = s_jpeg;

    // wxImage::LoadFile finds no handler for the type: wxInitAllImageHandlers has not run.
    if (!jpeg) return false;

    const ptr = jpeg._wxjpeg_alloc(aData.length);
    jpeg.HEAPU8.set(aData, ptr);

    const ok = jpeg._wxjpeg_load(ptr, aData.length) === 1;

    jpeg._wxjpeg_free(ptr);

    if (!ok) return false;

    const data = jpeg._wxjpeg_data();

    this.m_width = jpeg._wxjpeg_width();
    this.m_height = jpeg._wxjpeg_height();
    this.m_rgb = jpeg.HEAPU8.slice(data, data + jpeg._wxjpeg_size());
    this.m_alpha = null;
    this.m_options = new Map();

    // set up resolution if available: it's part of optional JFIF APP0 chunk
    if (jpeg._wxjpeg_saw_jfif()) {
      this.SetOption(wxIMAGE_OPTION_RESOLUTIONX, jpeg._wxjpeg_x_density());
      this.SetOption(wxIMAGE_OPTION_RESOLUTIONY, jpeg._wxjpeg_y_density());

      // we use the same values for this option as libjpeg so we don't need
      // any conversion here
      this.SetOption(wxIMAGE_OPTION_RESOLUTIONUNIT, jpeg._wxjpeg_density_unit());
    }

    jpeg._wxjpeg_release();

    return true;
  }

  private loadPng(aData: Uint8Array): boolean {
    // png_read_info checks the whole signature; CanRead looked at four bytes of it
    if (aData.length < 8) return false;

    for (let i = 0; i < 8; i++) if (aData[i] !== PNG_SIGNATURE[i]) return false;

    let pos = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    let interlace = 0;
    let palette: Uint8Array | null = null;
    let trns: Uint8Array | null = null;
    const idat: Uint8Array[] = [];
    let idatLen = 0;

    while (pos + 8 <= aData.length) {
      const len = be32(aData, pos);
      const type = String.fromCharCode(
        aData[pos + 4]!,
        aData[pos + 5]!,
        aData[pos + 6]!,
        aData[pos + 7]!,
      );
      const start = pos + 8;
      const end = start + len;

      if (end + 4 > aData.length) return false;

      if (pngCrc32(aData, pos + 4, end) !== be32(aData, end)) return false;

      const body = aData.subarray(start, end);

      switch (type) {
        case 'IHDR':
          width = be32(body, 0);
          height = be32(body, 4);
          bitDepth = body[8]!;
          colorType = body[9]!;
          interlace = body[12]!;
          break;
        case 'PLTE':
          palette = body;
          break;
        case 'tRNS':
          trns = body;
          break;
        case 'pHYs': {
          const resX = be32(body, 0);
          const resY = be32(body, 4);
          const unitType = body[8]!;

          // wxPNGHandler: PNG_RESOLUTION_METER -> dots per cm, an integer division
          if (unitType === 1) {
            this.m_options.set(wxIMAGE_OPTION_RESOLUTIONX, Math.trunc(resX / 100));
            this.m_options.set(wxIMAGE_OPTION_RESOLUTIONY, Math.trunc(resY / 100));
            this.m_options.set(
              wxIMAGE_OPTION_RESOLUTIONUNIT,
              wxImageResolution.wxIMAGE_RESOLUTION_CM,
            );
          }

          break;
        }
        case 'IDAT':
          idat.push(body);
          idatLen += body.length;
          break;
        case 'IEND':
          pos = aData.length;
          break;
        default:
          break;
      }

      pos = end + 4;
    }

    if (width === 0 || height === 0 || idat.length === 0) return false;

    const zdata = new Uint8Array(idatLen);
    let off = 0;

    for (const chunk of idat) {
      zdata.set(chunk, off);
      off += chunk.length;
    }

    const channels =
      colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : 4;
    const bitsPerPixel = channels * bitDepth;
    const bytesPerPixel = Math.max(1, bitsPerPixel >> 3);
    const raw = inflateZlib(zdata, height * (Math.ceil((width * bitsPerPixel) / 8) + 1));

    const rgb = new Uint8Array(width * height * 3);
    const hasAlpha = colorType === 4 || colorType === 6 || trns !== null;
    const alpha = hasAlpha ? new Uint8Array(width * height).fill(255) : null;

    // The pass geometry: the whole image as one pass, or Adam7's seven.
    const passes =
      interlace === 1
        ? [
            [0, 0, 8, 8],
            [4, 0, 8, 8],
            [0, 4, 4, 8],
            [2, 0, 4, 4],
            [0, 2, 2, 4],
            [1, 0, 2, 2],
            [0, 1, 1, 2],
          ]
        : [[0, 0, 1, 1]];

    let rawPos = 0;

    for (const [x0, y0, dx, dy] of passes) {
      const pw = Math.ceil((width - x0!) / dx!);
      const ph = Math.ceil((height - y0!) / dy!);

      if (pw <= 0 || ph <= 0) continue;

      const stride = Math.ceil((pw * bitsPerPixel) / 8);
      let prev = new Uint8Array(stride);

      for (let py = 0; py < ph; py++) {
        const filter = raw[rawPos++]!;
        const line = new Uint8Array(raw.subarray(rawPos, rawPos + stride));
        rawPos += stride;

        unfilter(filter, line, prev, bytesPerPixel);

        for (let px = 0; px < pw; px++) {
          const x = x0! + px * dx!;
          const y = y0! + py * dy!;
          const p = y * width + x;

          const sample = (i: number): number => {
            // the i-th sample of the pixel, scaled to 8 bits
            if (bitDepth === 8) return line[px * channels + i]!;

            if (bitDepth === 16) return line[(px * channels + i) * 2]!; // png_set_strip_16: the high byte

            const bitPos = (px * channels + i) * bitDepth;
            const byte = line[bitPos >> 3]!;
            const shift = 8 - bitDepth - (bitPos & 7);
            const v = (byte >> shift) & ((1 << bitDepth) - 1);

            if (colorType === 3) return v; // a palette index, not scaled

            return Math.trunc((v * 255) / ((1 << bitDepth) - 1)); // png_set_expand_gray_1_2_4_to_8
          };

          switch (colorType) {
            case 0: {
              const g = sample(0);
              rgb[p * 3] = g;
              rgb[p * 3 + 1] = g;
              rgb[p * 3 + 2] = g;

              if (trns && trns.length >= 2) {
                const key = (trns[0]! << 8) | trns[1]!;
                const rawV =
                  bitDepth === 16
                    ? (line[px * 2]! << 8) | line[px * 2 + 1]!
                    : bitDepth === 8
                      ? line[px]!
                      : (() => {
                          const bitPos = px * bitDepth;
                          return (
                            (line[bitPos >> 3]! >> (8 - bitDepth - (bitPos & 7))) &
                            ((1 << bitDepth) - 1)
                          );
                        })();

                if (rawV === key) alpha![p] = 0;
              }

              break;
            }
            case 2: {
              rgb[p * 3] = sample(0);
              rgb[p * 3 + 1] = sample(1);
              rgb[p * 3 + 2] = sample(2);

              if (trns && trns.length >= 6) {
                const r16 =
                  bitDepth === 16 ? (line[px * 6]! << 8) | line[px * 6 + 1]! : line[px * 3]!;
                const g16 =
                  bitDepth === 16
                    ? (line[px * 6 + 2]! << 8) | line[px * 6 + 3]!
                    : line[px * 3 + 1]!;
                const b16 =
                  bitDepth === 16
                    ? (line[px * 6 + 4]! << 8) | line[px * 6 + 5]!
                    : line[px * 3 + 2]!;
                const kr = (trns[0]! << 8) | trns[1]!;
                const kg = (trns[2]! << 8) | trns[3]!;
                const kb = (trns[4]! << 8) | trns[5]!;

                if (r16 === kr && g16 === kg && b16 === kb) alpha![p] = 0;
              }

              break;
            }
            case 3: {
              const idx = sample(0);

              if (palette && idx * 3 + 2 < palette.length) {
                rgb[p * 3] = palette[idx * 3]!;
                rgb[p * 3 + 1] = palette[idx * 3 + 1]!;
                rgb[p * 3 + 2] = palette[idx * 3 + 2]!;
              }

              if (trns) alpha![p] = idx < trns.length ? trns[idx]! : 255;

              break;
            }
            case 4: {
              const g = sample(0);
              rgb[p * 3] = g;
              rgb[p * 3 + 1] = g;
              rgb[p * 3 + 2] = g;
              alpha![p] = sample(1);
              break;
            }
            case 6:
              rgb[p * 3] = sample(0);
              rgb[p * 3 + 1] = sample(1);
              rgb[p * 3 + 2] = sample(2);
              alpha![p] = sample(3);
              break;
            default:
              return false;
          }
        }

        prev = line;
      }
    }

    this.m_width = width;
    this.m_height = height;
    this.m_rgb = rgb;
    this.m_alpha = alpha;

    return true;
  }
}

/** PNG scanline filters (RFC 2083 6.4), undone in place. */
function unfilter(aType: number, aLine: Uint8Array, aPrev: Uint8Array, aBpp: number): void {
  const n = aLine.length;

  switch (aType) {
    case 0:
      break;
    case 1:
      for (let i = aBpp; i < n; i++) aLine[i] = (aLine[i]! + aLine[i - aBpp]!) & 0xff;

      break;
    case 2:
      for (let i = 0; i < n; i++) aLine[i] = (aLine[i]! + aPrev[i]!) & 0xff;

      break;
    case 3:
      for (let i = 0; i < n; i++) {
        const left = i >= aBpp ? aLine[i - aBpp]! : 0;
        aLine[i] = (aLine[i]! + ((left + aPrev[i]!) >> 1)) & 0xff;
      }

      break;
    case 4:
      for (let i = 0; i < n; i++) {
        const a = i >= aBpp ? aLine[i - aBpp]! : 0;
        const b = aPrev[i]!;
        const c = i >= aBpp ? aPrev[i - aBpp]! : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        aLine[i] = (aLine[i]! + pred) & 0xff;
      }

      break;
    default:
      throw new Error(`PNG: unknown filter type ${aType}`);
  }
}
