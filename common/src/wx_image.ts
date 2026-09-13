// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The part of `wxImage` that `BITMAP_BASE` uses: an RGB plane, an optional
 * alpha plane, the resolution options, `LoadFile`/`SaveFile` for PNG,
 * `Rotate90`, `Mirror` and `ConvertToGreyscale`.
 *
 * PNG is decoded here (every colour type, bit depth and Adam7) and encoded
 * with `png_encoder.ts`. A JPEG is read for its size and JFIF density only —
 * there is no JPEG decoder here, so a JPEG's pixels cannot be transformed;
 * `wxJPEGHandler` would decode them through libjpeg.
 *
 * wx's PNG handler turns a `pHYs` in metres into dots per centimetre with an
 * integer division (`resX /= 100`), which is what makes a 3937 px/m (100 dpi)
 * file read back as 39 dots/cm; `BITMAP_BASE::updatePPI` then rounds
 * `39 * 2.54` to 99. That path is kept as it is.
 */

import { inflateZlib } from './inflate.js';
import { PNG_SIGNATURE, pngChunk, pngCrc32, zlibStored } from './png_encoder.js';

/** `wxImageResolution`. */
export enum wxImageResolution {
  wxIMAGE_RESOLUTION_NONE = 0,
  wxIMAGE_RESOLUTION_INCHES = 1,
  wxIMAGE_RESOLUTION_CM = 2,
}

/** `wxBitmapType`, the members the image code uses. */
export enum wxBitmapType {
  wxBITMAP_TYPE_INVALID = 0,
  wxBITMAP_TYPE_PNG = 15,
  wxBITMAP_TYPE_JPEG = 17,
  wxBITMAP_TYPE_ANY = 50,
}

export const wxIMAGE_OPTION_RESOLUTIONX = 'ResolutionX';
export const wxIMAGE_OPTION_RESOLUTIONY = 'ResolutionY';
export const wxIMAGE_OPTION_RESOLUTIONUNIT = 'ResolutionUnit';

const be32 = (b: Uint8Array, off: number): number =>
  ((b[off]! << 24) | (b[off + 1]! << 16) | (b[off + 2]! << 8) | b[off + 3]!) >>> 0;

const put32 = (b: Uint8Array, off: number, v: number): void => {
  b[off] = (v >>> 24) & 0xff;
  b[off + 1] = (v >>> 16) & 0xff;
  b[off + 2] = (v >>> 8) & 0xff;
  b[off + 3] = v & 0xff;
};

function isPng(aData: Uint8Array): boolean {
  if (aData.length < 8) return false;

  for (let i = 0; i < 8; i++) if (aData[i] !== PNG_SIGNATURE[i]) return false;

  return true;
}

function isJpeg(aData: Uint8Array): boolean {
  return aData.length >= 3 && aData[0] === 0xff && aData[1] === 0xd8 && aData[2] === 0xff;
}

/** `wxImage`. */
export class WX_IMAGE {
  private m_width = 0;
  private m_height = 0;
  private m_rgb: Uint8Array | null = null; // 3 bytes per pixel, row-major
  private m_alpha: Uint8Array | null = null; // 1 byte per pixel, or none
  private m_options = new Map<string, number>();
  private m_pixelsKnown = false; // false for a JPEG: the size is read, the pixels are not

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
      this.m_pixelsKnown = a.m_pixelsKnown;
    } else if (a !== undefined) {
      this.m_width = a;
      this.m_height = aHeight!;
      this.m_rgb = new Uint8Array(a * aHeight! * 3);
      this.m_pixelsKnown = true;
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
  /** The RGB plane; null for a JPEG, whose pixels are not decoded here. */
  GetData(): Uint8Array | null {
    return this.m_rgb;
  }
  GetAlpha(): Uint8Array | null {
    return this.m_alpha;
  }
  HasPixels(): boolean {
    return this.m_pixelsKnown;
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
   * `wxImage::LoadFile( wxInputStream&, wxBitmapType )`: the type is detected
   * from the signature.
   */
  LoadFile(aData: Uint8Array): boolean {
    if (isPng(aData)) return this.loadPng(aData);

    if (isJpeg(aData)) return this.loadJpegHeader(aData);

    return false;
  }

  /** The type `wxImage::LoadFile` would have detected. */
  static DetectType(aData: Uint8Array): wxBitmapType {
    if (isPng(aData)) return wxBitmapType.wxBITMAP_TYPE_PNG;

    if (isJpeg(aData)) return wxBitmapType.wxBITMAP_TYPE_JPEG;

    return wxBitmapType.wxBITMAP_TYPE_INVALID;
  }

  /**
   * `wxImage::SaveFile( wxOutputStream&, wxBITMAP_TYPE_PNG )`: RGB, or RGBA
   * when there is an alpha plane, with the resolution as a `pHYs`.
   */
  SaveFilePng(): Uint8Array | null {
    if (!this.IsOk() || !this.m_rgb) return null;

    const w = this.m_width;
    const h = this.m_height;
    const bpp = this.m_alpha ? 4 : 3;
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

        if (this.m_alpha) raw[d + 3] = this.m_alpha[y * w + x]!;
      }
    }

    const ihdr = new Uint8Array(13);
    put32(ihdr, 0, w);
    put32(ihdr, 4, h);
    ihdr[8] = 8;
    ihdr[9] = this.m_alpha ? 6 : 2;
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

    parts.push(pngChunk('IDAT', zlibStored(raw)));
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

    return out;
  }

  /**
   * `wxImage::ConvertToGreyscale( 0.299, 0.587, 0.114 )`: `wxColour::MakeGrey`,
   * a truncating cast of the weighted sum.
   */
  ConvertToGreyscale(): WX_IMAGE {
    const out = new WX_IMAGE(this);

    if (!out.m_rgb) throw new Error('wxImage::ConvertToGreyscale: the pixels are not decoded');

    for (let i = 0; i < out.m_rgb.length; i += 3) {
      const grey = Math.trunc(
        0.299 * out.m_rgb[i]! + 0.587 * out.m_rgb[i + 1]! + 0.114 * out.m_rgb[i + 2]!,
      );
      out.m_rgb[i] = grey;
      out.m_rgb[i + 1] = grey;
      out.m_rgb[i + 2] = grey;
    }

    return out;
  }

  private loadJpegHeader(aData: Uint8Array): boolean {
    // JFIF APP0 density and the SOFn frame header.
    let pos = 2;

    while (pos + 4 <= aData.length) {
      if (aData[pos] !== 0xff) return false;

      const marker = aData[pos + 1]!;
      const len = (aData[pos + 2]! << 8) | aData[pos + 3]!;

      if (marker === 0xe0 && pos + 4 + 14 <= aData.length) {
        // "JFIF\0", version, units, Xdensity, Ydensity
        if (
          aData[pos + 4] === 0x4a &&
          aData[pos + 5] === 0x46 &&
          aData[pos + 6] === 0x49 &&
          aData[pos + 7] === 0x46
        ) {
          const units = aData[pos + 11]!;
          const xd = (aData[pos + 12]! << 8) | aData[pos + 13]!;
          const yd = (aData[pos + 14]! << 8) | aData[pos + 15]!;

          // wxJPEGHandler: density_unit 1 = dots/inch, 2 = dots/cm
          if (units === 1 || units === 2) {
            this.m_options.set(wxIMAGE_OPTION_RESOLUTIONX, xd);
            this.m_options.set(wxIMAGE_OPTION_RESOLUTIONY, yd);
            this.m_options.set(
              wxIMAGE_OPTION_RESOLUTIONUNIT,
              units === 1
                ? wxImageResolution.wxIMAGE_RESOLUTION_INCHES
                : wxImageResolution.wxIMAGE_RESOLUTION_CM,
            );
          }
        }
      }

      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        if (pos + 9 > aData.length) return false;

        this.m_height = (aData[pos + 5]! << 8) | aData[pos + 6]!;
        this.m_width = (aData[pos + 7]! << 8) | aData[pos + 8]!;
        this.m_rgb = null;
        this.m_alpha = null;
        this.m_pixelsKnown = false;

        return this.m_width > 0 && this.m_height > 0;
      }

      if (marker === 0xd9 || marker === 0xda) return false;

      pos += 2 + len;
    }

    return false;
  }

  private loadPng(aData: Uint8Array): boolean {
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
    this.m_pixelsKnown = true;

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
