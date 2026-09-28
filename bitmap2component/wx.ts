// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The wxWidgets calls `BITMAP2CMP_PANEL` stands on, as wxGTK 3.2 (the
 * library KiCad 10.0.5 links) answers them on this machine: `wxImage`
 * (`LoadFile`'s result, `ConvertToGreyscale`, `GetOptionInt`), the depth of
 * the `wxBitmap` made from it, and `wxString::ToDouble`.
 *
 * No KiCad unit: this is the toolkit, kept beside its one caller as
 * `gerbview/libc.ts` keeps the C library beside the readers. Each behaviour
 * below was measured, not read off wx's source:
 *
 * - `qa/probes/wximage_greyscale_probe.cpp`: `ConvertToGreyscale` is
 *   `wxRound( 0.299 r + 0.587 g + 0.114 b )` for all 2^24 colours.
 * - `qa/probes/wximage_transparency_probe.cpp`: what `LoadFile` keeps of
 *   transparency and resolution, per format (see `wxImage.Load`).
 *
 * The browser decodes the file (a canvas hands back RGBA); what wx would have
 * made of the same file is rebuilt from that plus the file's own header
 * bytes. One loss is the browser's: a canvas stores premultiplied alpha, so a
 * partly transparent pixel's colour comes back rounded, and a fully
 * transparent one's as black. `binarize` never reads the colour of a pixel
 * whose alpha fails its cut, so only the Greyscale page can show it.
 */
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';

/** `wxIMAGE_OPTION_RESOLUTIONX` / `Y` / `UNIT`. */
export const wxIMAGE_OPTION_RESOLUTIONX = 'ResolutionX';
export const wxIMAGE_OPTION_RESOLUTIONY = 'ResolutionY';
export const wxIMAGE_OPTION_RESOLUTIONUNIT = 'ResolutionUnit';

/** `wxImageResolution`. */
export const wxIMAGE_RESOLUTION_NONE = 0;
export const wxIMAGE_RESOLUTION_INCHES = 1;
export const wxIMAGE_RESOLUTION_CM = 2;

/** `wxALPHA_OPAQUE`. */
export const wxALPHA_OPAQUE = 255;

/** `wxRound`: halves away from zero. */
const wxRound = KiROUND;

export class wxImage {
  private m_width = 0;
  private m_height = 0;
  /** RGB, three bytes a pixel. */
  private m_data: Uint8Array = new Uint8Array(0);
  /** One byte a pixel, or null when the image has no alpha channel. */
  private m_alpha: Uint8Array | null = null;
  private m_hasMask = false;
  private m_maskRGB: [number, number, number] = [0, 0, 0];
  private m_options = new Map<string, number>();

  /** `wxImage( width, height )`: black, no alpha. */
  static Create(aWidth: number, aHeight: number): wxImage {
    const img = new wxImage();
    img.m_width = aWidth;
    img.m_height = aHeight;
    img.m_data = new Uint8Array(aWidth * aHeight * 3);
    return img;
  }

  /**
   * `wxImage::LoadFile`, rebuilt from the browser's decode (`aRGBA`, straight
   * from a canvas) and the file's bytes. Returns null when wx has no handler
   * for the format — wx's `LoadFile` fails then ("Unknown image data format").
   *
   * Per format, as the probe measured:
   * - PNG: an alpha channel only if some pixel is not fully opaque (an RGBA
   *   file that is opaque everywhere has none; a palette `tRNS` gives one);
   *   `pHYs` in metres becomes CM with `trunc( ppm / 100 )`, an unknown-unit
   *   `pHYs` is passed through with unit NONE.
   * - JPEG: no alpha; JFIF density and unit passed through as they are.
   * - BMP: alpha as PNG; `biXPelsPerMeter` becomes CM with `trunc( ppm / 100 )`.
   * - GIF: no alpha. A transparent colour becomes a **mask**: transparent
   *   pixels are set to (255,0,255), any opaque (255,0,255) is moved to
   *   (255,0,254), and the mask colour is (255,0,255).
   */
  static Load(
    aBytes: Uint8Array,
    aRGBA: Uint8ClampedArray,
    aWidth: number,
    aHeight: number,
  ): wxImage | null {
    const kind = sniff(aBytes);

    if (!kind) return null;

    const img = wxImage.Create(aWidth, aHeight);
    const n = aWidth * aHeight;

    for (let i = 0; i < n; i++) {
      img.m_data[i * 3] = aRGBA[i * 4]!;
      img.m_data[i * 3 + 1] = aRGBA[i * 4 + 1]!;
      img.m_data[i * 3 + 2] = aRGBA[i * 4 + 2]!;
    }

    let translucent = false;

    for (let i = 0; i < n && !translucent; i++) translucent = aRGBA[i * 4 + 3]! < 255;

    if (kind === 'gif') {
      if (translucent) {
        for (let i = 0; i < n; i++) {
          const d = img.m_data;

          if (aRGBA[i * 4 + 3]! === 0) {
            d[i * 3] = 255;
            d[i * 3 + 1] = 0;
            d[i * 3 + 2] = 255;
          } else if (d[i * 3] === 255 && d[i * 3 + 1] === 0 && d[i * 3 + 2] === 255) {
            d[i * 3 + 2] = 254;
          }
        }

        img.SetMaskColour(255, 0, 255);
      }
    } else if (kind !== 'jpeg' && translucent) {
      img.m_alpha = new Uint8Array(n);

      for (let i = 0; i < n; i++) img.m_alpha[i] = aRGBA[i * 4 + 3]!;
    }

    const res = resolution(kind, aBytes);

    if (res) {
      img.SetOption(wxIMAGE_OPTION_RESOLUTIONX, res.x);
      img.SetOption(wxIMAGE_OPTION_RESOLUTIONY, res.y);
      img.SetOption(wxIMAGE_OPTION_RESOLUTIONUNIT, res.unit);
    }

    return img;
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

  GetRed(x: number, y: number): number {
    return this.m_data[(y * this.m_width + x) * 3]!;
  }

  GetGreen(x: number, y: number): number {
    return this.m_data[(y * this.m_width + x) * 3 + 1]!;
  }

  GetBlue(x: number, y: number): number {
    return this.m_data[(y * this.m_width + x) * 3 + 2]!;
  }

  SetRGB(x: number, y: number, r: number, g: number, b: number): void {
    const i = (y * this.m_width + x) * 3;
    this.m_data[i] = r;
    this.m_data[i + 1] = g;
    this.m_data[i + 2] = b;
  }

  HasAlpha(): boolean {
    return this.m_alpha !== null;
  }

  GetAlpha(x: number, y: number): number {
    return this.m_alpha![y * this.m_width + x]!;
  }

  HasMask(): boolean {
    return this.m_hasMask;
  }

  SetMaskColour(r: number, g: number, b: number): void {
    this.m_hasMask = true;
    this.m_maskRGB = [r, g, b];
  }

  GetMaskRed(): number {
    return this.m_maskRGB[0];
  }

  GetMaskGreen(): number {
    return this.m_maskRGB[1];
  }

  GetMaskBlue(): number {
    return this.m_maskRGB[2];
  }

  SetOption(aName: string, aValue: number): void {
    this.m_options.set(aName, aValue);
  }

  /** `GetOptionInt`: 0 for an option never set. */
  GetOptionInt(aName: string): number {
    return this.m_options.get(aName) ?? 0;
  }

  /** The copy `operator=` makes (wx shares the data copy-on-write; same effect). */
  Copy(): wxImage {
    const img = wxImage.Create(this.m_width, this.m_height);
    img.m_data.set(this.m_data);
    img.m_alpha = this.m_alpha ? this.m_alpha.slice() : null;
    img.m_hasMask = this.m_hasMask;
    img.m_maskRGB = [...this.m_maskRGB];
    img.m_options = new Map(this.m_options);
    return img;
  }

  /**
   * `ConvertToGreyscale()`: alpha and mask are copied; every pixel not of the
   * mask colour becomes `wxRound( 0.299 r + 0.587 g + 0.114 b )` in all three
   * channels.
   */
  ConvertToGreyscale(weight_r = 0.299, weight_g = 0.587, weight_b = 0.114): wxImage {
    const img = this.Copy();
    const [mr, mg, mb] = this.m_maskRGB;
    const d = img.m_data;

    for (let i = 0; i < this.m_width * this.m_height; i++) {
      const r = d[i * 3]!;
      const g = d[i * 3 + 1]!;
      const b = d[i * 3 + 2]!;

      // don't modify the mask
      if (this.m_hasMask && r === mr && g === mg && b === mb) continue;

      const c = wxRound(r * weight_r + g * weight_g + b * weight_b);
      d[i * 3] = d[i * 3 + 1] = d[i * 3 + 2] = c;
    }

    return img;
  }
}

/**
 * `wxBitmap( image ).GetDepth()`: 32 with an alpha channel, 24 without.
 * Probed against wxGTK 3.2 earlier (the `BPP:` readout): an RGBA PNG opaque
 * everywhere reports 24, one with a transparent or half-transparent pixel 32.
 */
export function wxBitmapDepth(aImage: wxImage): number {
  return aImage.HasAlpha() ? 32 : 24;
}

/**
 * `wxString::ToDouble( &val )`: `strtod` over the whole string. True only when
 * the scan reaches the end of a non-empty string and no over- or underflow
 * (ERANGE) occurred. Returns the value, or null for false. Leading blanks are
 * skipped, trailing ones are not; `inf`, `infinity` and `nan` convert, as C's
 * strtod converts them.
 */
export function wxStringToDouble(aText: string): number | null {
  const m =
    /^[ \t\n\v\f\r]*([+-]?)(?:(inf(?:inity)?|nan)|((?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?))$/i.exec(
      aText,
    );

  if (!m) return null;

  const sign = m[1] === '-' ? -1 : 1;

  if (m[2]) return /^nan$/i.test(m[2]) ? Number.NaN : sign * Infinity;

  const v = sign * Number(m[3]);

  if (!Number.isFinite(v)) return null; // overflow: ERANGE

  if (v === 0 && /[1-9]/.test(m[3]!.split(/[eE]/)[0]!)) return null; // underflow: ERANGE

  return v;
}

type ImageKind = 'png' | 'jpeg' | 'bmp' | 'gif';

/** Which of wx's handlers would claim these bytes (the formats KiCad's file dialog offers). */
function sniff(b: Uint8Array): ImageKind | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8) return 'jpeg';
  if (b.length > 2 && b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38)
    return 'gif';
  return null;
}

const u32be = (b: Uint8Array, o: number): number =>
  ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const u16be = (b: Uint8Array, o: number): number => (b[o]! << 8) | b[o + 1]!;
const u32le = (b: Uint8Array, o: number): number =>
  ((b[o + 3]! << 24) | (b[o + 2]! << 16) | (b[o + 1]! << 8) | b[o]!) >>> 0;

interface Resolution {
  x: number;
  y: number;
  unit: number;
}

/** The three resolution options the handler sets, or null when it sets none. */
function resolution(kind: ImageKind, b: Uint8Array): Resolution | null {
  switch (kind) {
    case 'png': {
      let off = 8;

      while (off + 8 <= b.length) {
        const len = u32be(b, off);
        const type = String.fromCharCode(b[off + 4]!, b[off + 5]!, b[off + 6]!, b[off + 7]!);

        if (type === 'pHYs' && len >= 9) {
          const d = off + 8;
          const x = u32be(b, d);
          const y = u32be(b, d + 4);

          if (b[d + 8] === 1)
            return { x: Math.trunc(x / 100), y: Math.trunc(y / 100), unit: wxIMAGE_RESOLUTION_CM };

          return { x, y, unit: wxIMAGE_RESOLUTION_NONE };
        }

        if (type === 'IDAT' || type === 'IEND') break;

        off += 12 + len;
      }

      return null;
    }

    case 'jpeg': {
      let off = 2;

      while (off + 4 <= b.length && b[off] === 0xff) {
        const marker = b[off + 1]!;

        if (marker === 0xd9 || marker === 0xda) break; // EOI / start of scan

        const len = u16be(b, off + 2);

        if (marker === 0xe0 && len >= 16) {
          const d = off + 4;
          const jfif = String.fromCharCode(b[d]!, b[d + 1]!, b[d + 2]!, b[d + 3]!);

          if (jfif === 'JFIF') return { x: u16be(b, d + 8), y: u16be(b, d + 10), unit: b[d + 7]! };
        }

        off += 2 + len;
      }

      return null;
    }

    case 'bmp':
      // BITMAPINFOHEADER at offset 14: XPelsPerMeter / YPelsPerMeter at +24 / +28.
      if (b.length < 14 + 32) return null;

      return {
        x: Math.trunc(u32le(b, 14 + 24) / 100),
        y: Math.trunc(u32le(b, 14 + 28) / 100),
        unit: wxIMAGE_RESOLUTION_CM,
      };

    case 'gif':
      return null;
  }
}
