// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from wxWidgets 3.2.4 src/common/imagbmp.cpp, copyright Robert Roebling,
// Vaclav Slavik and the wxWidgets team (wxWindows Library Licence).
/**
 * `wxBMPHandler`'s reading half: `LoadFile` -> `LoadDib` -> `LoadBMPData`, for a .bmp (the ICO
 * and CUR mask path is not reachable from wxImage::LoadFile on a BMP and is not here). Read from a
 * `wxMemoryInputStream`, so a truncated file loads or fails as it does in KiCad.
 *
 * Where wx is undefined the port is zero: the palette is allocated larger than its colour count
 * and the extra entries are uninitialised in wx, read only by an index past the count.
 */

import { type wxMemoryInputStream, wxInvalidOffset, wxSeekMode, wxStreamError } from './mstream.js';

/** What `LoadBMPData` does to the image: wxImage's Create, alpha, mask and options. */
export interface BMP_IMAGE_SINK {
  /** `Destroy(); Create( width, height )`: false when it cannot be made. */
  Create(aWidth: number, aHeight: number): boolean;
  GetData(): Uint8Array | null;
  /** `SetAlpha()`: an alpha plane to fill. */
  SetAlpha(): void;
  GetAlpha(): Uint8Array | null;
  ClearAlpha(): void;
  SetMask(aMask: boolean): void;
  SetOption(aName: string, aValue: number): void;
}

const BI_RGB = 0;
const BI_RLE8 = 1;
const BI_RLE4 = 2;
const BI_BITFIELDS = 3;

const wxALPHA_TRANSPARENT = 0;
const wxIMAGE_RESOLUTION_CM = 2;

interface BMPPalette {
  r: number;
  g: number;
  b: number;
}

interface BMPDesc {
  width: number;
  height: number;
  bpp: number;
  ncolors: number;
  comp: number; // BI_RGB, BI_RLE4, BI_RLE8 or BI_BITFIELDS only supported
  paletteData: BMPPalette[] | null;
  rmask: number;
  gmask: number;
  bmask: number;
  amask: number;
}

const le16 = (b: Uint8Array) => b[0]! | (b[1]! << 8);
/** A little-endian wxInt32. */
const le32 = (b: Uint8Array, o = 0) =>
  b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24);

/** `wxInputStream::ReadAll` into a fresh buffer: the bytes, or null when not all came. */
function ReadAll(aStream: wxMemoryInputStream, aSize: number): Uint8Array | null {
  const buf = new Uint8Array(aSize);
  let total = 0;
  let size = aSize;

  for (;;) {
    const lastCount = aStream.Read(buf, size, total).LastRead();

    // There is no point in continuing looping if we can't read anything at all.
    if (!lastCount) break;

    total += lastCount;

    // ... Or if an error occurred on the stream.
    if (!aStream.IsOk()) break;

    if (lastCount >= size) {
      size = 0;
      break;
    }

    size -= lastCount;
  }

  return size === 0 ? buf : null;
}

/**
 * `LoadBMPData`: the pixels, the stream at the start of the bitmap data (after the palette).
 */
function LoadBMPData(
  aImage: BMP_IMAGE_SINK,
  aDesc: BMPDesc,
  aStream: wxMemoryInputStream,
): boolean {
  const width = aDesc.width;
  let height = aDesc.height;
  const bpp = aDesc.bpp;
  const ncolors = aDesc.ncolors;

  let rmask = 0;
  let gmask = 0;
  let bmask = 0;
  let amask = 0;
  let rshift = 0;
  let gshift = 0;
  let bshift = 0;
  let ashift = 0;
  let rbits = 0;
  let gbits = 0;
  let bbits = 0;
  let cmap: BMPPalette[] = [];

  let isUpsideDown = true;

  if (height < 0) {
    isUpsideDown = false;
    height = -height;
  }

  // destroy existing here instead of:
  if (!aImage.Create(width, height)) return false; // "BMP: Couldn't allocate memory."

  const ptr = aImage.GetData()!;
  let alpha: Uint8Array | null = null;

  if (bpp === 32) {
    // tell the image to allocate an alpha buffer
    aImage.SetAlpha();
    alpha = aImage.GetAlpha();
  }

  // Reading the palette, if it exists:
  if (bpp < 16 && ncolors !== 0) {
    // Use the data from the bitmap header if we have it; else the ICO mask's black and white.
    cmap = aDesc.paletteData ?? [
      { r: 0, g: 0, b: 0 },
      { r: 255, g: 255, b: 255 },
    ];
  } else if (bpp === 16 || bpp === 32) {
    if (aDesc.comp === BI_BITFIELDS) {
      rmask = aDesc.rmask;
      gmask = aDesc.gmask;
      bmask = aDesc.bmask;

      // find shift amount (Least significant bit of mask)
      for (let bit = bpp - 1; bit >= 0; bit--) {
        if (bmask & (1 << bit)) bshift = bit;
        if (gmask & (1 << bit)) gshift = bit;
        if (rmask & (1 << bit)) rshift = bit;
      }

      // Find number of bits in mask (MSB-LSB+1)
      for (let bit = 0; bit < bpp; bit++) {
        if (bmask & (1 << bit)) bbits = bit - bshift + 1;
        if (gmask & (1 << bit)) gbits = bit - gshift + 1;
        if (rmask & (1 << bit)) rbits = bit - rshift + 1;
      }
      // amask is left 0: wx reads desc.amask from the header and never uses it here.
    } else if (bpp === 16) {
      rmask = 0x7c00;
      gmask = 0x03e0;
      bmask = 0x001f;
      rshift = 10;
      gshift = 5;
      bshift = 0;
      rbits = 5;
      gbits = 5;
      bbits = 5;
    } else if (bpp === 32) {
      rmask = 0x00ff0000;
      gmask = 0x0000ff00;
      bmask = 0x000000ff;
      amask = 0xff000000 | 0; // a wxInt32
      ashift = 24;
      rshift = 16;
      gshift = 8;
      bshift = 0;
      rbits = 8;
      gbits = 8;
      bbits = 8;
    }
  }

  const entry = (aIndex: number): BMPPalette => cmap[aIndex] ?? { r: 0, g: 0, b: 0 };

  // set the whole image to the background color
  if (bpp < 16 && (aDesc.comp === BI_RLE4 || aDesc.comp === BI_RLE8)) {
    const bg = entry(0);

    for (let i = 0; i < width * height; i++) {
      ptr[i * 3] = bg.r;
      ptr[i * 3 + 1] = bg.g;
      ptr[i * 3 + 2] = bg.b;
    }
  }

  const linesize = Math.trunc((width * bpp + 31) / 32) * 4;

  // flag indicating if we have any not fully transparent alpha values (#10915)
  let hasValidAlpha = false;

  /** `ptr[poffset..]` = a palette entry; poffset is (line * width + column) * 3. */
  const put = (aLine: number, aColumn: number, aRed: number, aGreen: number, aBlue: number) => {
    const poffset = aLine * width * 3 + aColumn * 3;
    ptr[poffset] = aRed;
    ptr[poffset + 1] = aGreen;
    ptr[poffset + 2] = aBlue;
  };
  const putIndex = (aLine: number, aColumn: number, aIndex: number) => {
    const c = entry(aIndex);
    put(aLine, aColumn, c.r, c.g, c.b);
  };
  /** `aByte = stream.GetC(); if ( !stream.IsOk() ) return false;` - null for the return. */
  const getByte = (): number | null => {
    const c = aStream.GetC() & 0xff;
    return aStream.IsOk() ? c : null;
  };

  for (let row = 0; row < height; row++) {
    let line = isUpsideDown ? height - 1 - row : row;
    let linepos = 0;

    for (let column = 0; column < width; ) {
      if (bpp < 16) {
        linepos++;
        let aByte = getByte();

        if (aByte === null) return false;

        if (bpp === 1) {
          for (let bit = 0; bit < 8 && column < width; bit++) {
            putIndex(line, column, aByte & (0x80 >> bit) ? 1 : 0);
            column++;
          }
        } else if (bpp === 4) {
          if (aDesc.comp === BI_RLE4) {
            const first = aByte;
            aByte = getByte();

            if (aByte === null) return false;

            if (first === 0) {
              // This is an escape sequence with special meaning.
              if (aByte === 0) {
                // end of scanline marker, ignored if the end-of-line was implicitly assumed
                if (column !== 0) column = width;
              } else if (aByte === 1) {
                // end of RLE data marker, stop decoding
                column = width;
                row = height;
              } else if (aByte === 2) {
                // delta marker, move in image
                const dx = getByte();

                if (dx === null) return false;

                column += dx;

                const dy = getByte();

                if (dy === null) return false;

                row += dy;
                line = isUpsideDown ? height - 1 - row : row;
              } else {
                // absolute mode (pixels not runs)
                const absolute = aByte;
                const nibble = [0, 0];
                let readBytes = 0;

                for (let k = 0; k < absolute; k++) {
                  if (!(k % 2)) {
                    ++readBytes;
                    const b = getByte();

                    if (b === null) return false;

                    nibble[0] = (b & 0xf0) >> 4;
                    nibble[1] = b & 0x0f;
                  }

                  putIndex(line, column, nibble[k % 2]!);
                  column++;
                }

                if (readBytes & 0x01 && getByte() === null) return false;
              }
            } else {
              const nibble = [(aByte & 0xf0) >> 4, aByte & 0x0f];

              for (let l = 0; l < first && column < width; l++) {
                putIndex(line, column, nibble[l % 2]!);
                column++;
              }
            }
          } else {
            for (let nibble = 0; nibble < 2 && column < width; nibble++) {
              let index = (aByte & (0xf0 >> (nibble * 4))) >> ((nibble ? 0 : 1) * 4);

              if (index >= 16) index = 15;

              putIndex(line, column, index);
              column++;
            }
          }
        } else if (bpp === 8) {
          if (aDesc.comp === BI_RLE8) {
            const first = aByte;
            aByte = getByte();

            if (aByte === null) return false;

            if (first === 0) {
              if (aByte === 0) {
                // end of scanline marker
                if (column !== 0) column = width;
              } else if (aByte === 1) {
                // end of RLE data marker, stop decoding
                column = width;
                row = height;
              } else if (aByte === 2) {
                // delta marker, move in image
                const dx = getByte();

                if (dx === null) return false;

                column += dx;

                const dy = getByte();

                if (dy === null) return false;

                row += dy;
                line = isUpsideDown ? height - 1 - row : row;
              } else {
                // absolute mode (pixels not runs)
                const absolute = aByte;

                for (let k = 0; k < absolute; k++) {
                  const b = getByte();

                  if (b === null) return false;

                  putIndex(line, column, b);
                  column++;
                }

                if (absolute & 0x01 && getByte() === null) return false;
              }
            } else {
              // encoded mode (repeat aByte first times)
              for (let l = 0; l < first && column < width; l++) {
                putIndex(line, column, aByte);
                column++;
              }
            }
          } else {
            putIndex(line, column, aByte);
            column++;
          }
        }
      } else if (bpp === 24) {
        const bbuf = ReadAll(aStream, 3);

        if (!bbuf) return false;

        linepos += 3;
        put(line, column, bbuf[2]!, bbuf[1]!, bbuf[0]!);
        column++;
      } else if (bpp === 16) {
        const w = ReadAll(aStream, 2);

        if (!w) return false;

        const aWord = le16(w);
        linepos += 2;

        // Use the masks and calculated amount of shift to retrieve the color data out of the
        // word. Then shift it left by (8 - number of bits) such that the image has the proper
        // dynamic range
        put(
          line,
          column,
          (((aWord & rmask) >> rshift) << (8 - rbits)) & 0xff,
          (((aWord & gmask) >> gshift) << (8 - gbits)) & 0xff,
          (((aWord & bmask) >> bshift) << (8 - bbits)) & 0xff,
        );
        column++;
      } else {
        const d = ReadAll(aStream, 4);

        if (!d) return false;

        const aDword = le32(d); // a wxInt32: the shifts below are arithmetic, as in C
        linepos += 4;
        put(
          line,
          column,
          ((aDword & rmask) >> rshift) & 0xff,
          ((aDword & gmask) >> gshift) & 0xff,
          ((aDword & bmask) >> bshift) & 0xff,
        );

        if (alpha) {
          const temp = ((aDword & amask) >> ashift) & 0xff;
          alpha[line * width + column] = temp;

          if (temp !== wxALPHA_TRANSPARENT) hasValidAlpha = true;
        }

        column++;
      }
    }

    while (linepos < linesize && aDesc.comp !== BI_RLE8 && aDesc.comp !== BI_RLE4) {
      ++linepos;

      if (!ReadAll(aStream, 1)) break;
    }
  }

  aImage.SetMask(false);

  // check if we had any valid alpha values in this bitmap
  if (alpha && !hasValidAlpha) {
    // we didn't, so finally discard the alpha channel completely
    aImage.ClearAlpha();
  }

  const err = aStream.GetLastError();
  return err === wxStreamError.wxSTREAM_NO_ERROR || err === wxStreamError.wxSTREAM_EOF;
}

/** `wxBMPHandler::LoadDib( image, stream, verbose, IsBmp = true )`. */
function LoadDib(aImage: BMP_IMAGE_SINK, aStream: wxMemoryInputStream): boolean {
  // read the header off the .BMP format file
  if (!ReadAll(aStream, 2)) return false;

  let dbuf = ReadAll(aStream, 16);

  if (!dbuf) return false;

  // offset to bitmap data
  const offset = le32(dbuf, 8);
  // DIB header size (used to distinguish different versions of DIB header)
  const hdrSize = le32(dbuf, 12);

  // Bitmap files come in old v1 format using BITMAPCOREHEADER or a newer format.
  const usesV1 = hdrSize === 12;

  const desc: BMPDesc = {
    width: 0,
    height: 0,
    bpp: 0,
    ncolors: 0,
    comp: BI_RGB,
    paletteData: null,
    rmask: 0,
    gmask: 0,
    bmask: 0,
    amask: 0,
  };

  if (usesV1) {
    const buf = ReadAll(aStream, 4);

    if (!buf) return false;

    // two wxInt16s
    desc.width = ((buf[0]! | (buf[1]! << 8)) << 16) >> 16;
    desc.height = ((buf[2]! | (buf[3]! << 8)) << 16) >> 16;
  } else {
    // We have at least BITMAPINFOHEADER
    dbuf = ReadAll(aStream, 4 * 2);

    if (!dbuf) return false;

    desc.width = le32(dbuf, 0);
    desc.height = le32(dbuf, 4);
  }

  // "DIB Header: Image width > 32767 pixels for file." and the same for height
  if (desc.width > 32767) return false;
  if (desc.height > 32767) return false;

  // planes, unused
  if (!ReadAll(aStream, 2)) return false;

  const bppWord = ReadAll(aStream, 2);

  if (!bppWord) return false;

  desc.bpp = le16(bppWord);

  // "DIB Header: Unknown bitdepth in file."
  if (![1, 4, 8, 16, 24, 32].includes(desc.bpp)) return false;

  let res: { x: number; y: number } | null = null;

  if (usesV1) {
    // The only possible format is BI_RGB and colours count is not used.
    desc.comp = BI_RGB;
    desc.ncolors = 0;
  } else {
    dbuf = ReadAll(aStream, 4 * 4);

    if (!dbuf) return false;

    // Sanity check: encoding must be consistent with the depth.
    let mismatch = false;

    desc.comp = le32(dbuf, 0);

    switch (desc.comp) {
      case BI_RGB:
        break;
      case BI_RLE4:
        if (desc.bpp !== 4) mismatch = true;
        break;
      case BI_RLE8:
        if (desc.bpp !== 8) mismatch = true;
        break;
      case BI_BITFIELDS:
        if (desc.bpp !== 16 && desc.bpp !== 32) mismatch = true;
        break;
      default:
        return false; // "DIB Header: Unknown encoding in file."
    }

    // "DIB Header: Encoding doesn't match bitdepth."
    if (mismatch) return false;

    // pixels per metre, as integer division by 100 makes dots per centimetre
    res = { x: Math.trunc(le32(dbuf, 8) / 100), y: Math.trunc(le32(dbuf, 12) / 100) };

    dbuf = ReadAll(aStream, 4 * 2);

    if (!dbuf) return false;

    desc.ncolors = le32(dbuf, 0);

    // "BMP: header has biClrUsed=%d when biBitCount=%d."
    if (desc.ncolors < 0 || 256 < desc.ncolors) return false;

    // We may have to forward the stream past BITMAPV4HEADER or BITMAPV5HEADER fields.
    let hdrBytesRead = 40; // sizeof(BITMAPINFOHEADER)

    if (desc.comp === BI_BITFIELDS) {
      // Read the mask values from the header.
      dbuf = ReadAll(aStream, 4 * 4);

      if (!dbuf) return false;

      hdrBytesRead += 4 * 4;

      desc.rmask = le32(dbuf, 0);
      desc.gmask = le32(dbuf, 4);
      desc.bmask = le32(dbuf, 8);
      desc.amask = le32(dbuf, 12);
    }

    // Now that we've read everything we needed from the header, advance past it.
    if (hdrSize > hdrBytesRead) {
      if (aStream.SeekI(hdrSize - hdrBytesRead, wxSeekMode.wxFromCurrent) === wxInvalidOffset)
        return false;
    }
  }

  // We must have read the header entirely by now and the 14 bytes before it.
  let bytesRead = 14 + hdrSize;

  // We must have a palette for 1bpp, 4bpp and 8bpp bitmaps.
  if (desc.ncolors === 0 && desc.bpp < 16) desc.ncolors = 1 << desc.bpp;

  // Now read the palette data, which follows the header, if we have it.
  if (desc.ncolors) {
    const paletteEntrySize = usesV1 ? 3 : 4;
    const paletteSize = paletteEntrySize * desc.ncolors;
    const data = ReadAll(aStream, paletteSize);

    if (!data) return false;

    bytesRead += paletteSize;

    // This is not a typo: entries are actually in BGR order.
    desc.paletteData = [];

    for (let n = 0; n < desc.ncolors; ++n) {
      const o = n * paletteEntrySize;
      desc.paletteData.push({ b: data[o]!, g: data[o + 1]!, r: data[o + 2]! });
    }
  }

  // We may have a gap between the palette and start of the pixel data, skip it if necessary.
  if (bytesRead < offset) {
    if (aStream.SeekI(offset - bytesRead, wxSeekMode.wxFromCurrent) === wxInvalidOffset)
      return false;
  }

  // read DIB; this is the BMP image. "Error in reading image DIB."
  if (!LoadBMPData(aImage, desc, aStream)) return false;

  // the resolution in the bitmap header is in meters, convert to centimeters
  if (res) {
    aImage.SetOption('ResolutionUnit', wxIMAGE_RESOLUTION_CM);
    aImage.SetOption('ResolutionX', res.x);
    aImage.SetOption('ResolutionY', res.y);
  }

  return true;
}

/** `wxBMPHandler::LoadFile`: a single DIB from the file. */
export function wxBMPHandlerLoadFile(
  aImage: BMP_IMAGE_SINK,
  aStream: wxMemoryInputStream,
): boolean {
  return LoadDib(aImage, aStream);
}
