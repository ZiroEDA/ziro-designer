// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from wxWidgets 3.2.4 src/common/gifdecod.cpp, copyright Guillermo Rodriguez
// Garcia and Vaclav Slavik (wxWindows Library Licence).
/**
 * `wxGIFDecoder`: wx's own LZW decoder, read from a `wxMemoryInputStream` with that stream's
 * end-of-data rules, so a truncated or broken GIF decodes - or fails - as it does in KiCad.
 *
 * Two places differ only where wx's are undefined: the frame and palette buffers, and the LZW
 * tables, are malloc'd uninitialised in wx and zeroed here. A complete GIF never reads them before
 * writing them; a truncated frame's undecoded pixels are palette index 0 here and whatever the
 * heap held in KiCad (a fresh process's zeroed pages agree with this).
 */

import { wxInvalidOffset, type wxMemoryInputStream, wxSeekMode } from './mstream.js';

/** `wxGIFErrorCode`. */
export enum wxGIFErrorCode {
  wxGIF_OK = 0, // everything was OK
  wxGIF_INVFORMAT, // error in GIF header
  wxGIF_MEMERR, // error allocating memory
  wxGIF_TRUNCATED, // file appears to be truncated
}

/** `wxAnimationDisposal`. */
export enum wxAnimationDisposal {
  wxANIM_UNSPECIFIED = -1,
  wxANIM_DONOTREMOVE = 0,
  wxANIM_TOBACKGROUND = 1,
  wxANIM_TOPREVIOUS = 2,
}

const GIF_MARKER_EXT = 0x21; // '!'
const GIF_MARKER_SEP = 0x2c; // ','
const GIF_MARKER_ENDOFDATA = 0x3b; // ';'
const GIF_MARKER_EXT_GRAPHICS_CONTROL = 0xf9;
const GIF_MARKER_EXT_COMMENT = 0xfe;

/** What `ConvertToImage` fills in: wxImage's Create / SetMaskColour / SetMask, and the data. */
export interface GIF_IMAGE_SINK {
  /** `wxImage::Create( w, h )`: a black image of that size; false when it cannot be made. */
  Create(aWidth: number, aHeight: number): boolean;
  /** The RGB plane Create made. */
  GetData(): Uint8Array | null;
  SetMaskColour(aRed: number, aGreen: number, aBlue: number): void;
  SetMask(aMask: boolean): void;
}

/** `GIFImage`: one frame. */
class GIFImage {
  w = 0; // width
  h = 0; // height
  left = 0; // x coord (in logical screen)
  top = 0; // y coord (in logical screen)
  transparent = 0; // transparent color index (-1 = none)
  disposal = wxAnimationDisposal.wxANIM_DONOTREMOVE; // disposal method
  delay = -1; // delay in ms (-1 = unused)
  p = new Uint8Array(0); // bitmap
  pal = new Uint8Array(768); // palette
  ncolours = 0; // number of colours
}

/** The stream byte as `unsigned char type = stream.GetC()` keeps it: wxEOF becomes 0xFF. */
const asUnsignedChar = (aC: number): number => aC & 0xff;

export class wxGIFDecoder {
  private m_frames: GIFImage[] = [];
  private m_nFrames = 0;
  private m_szAnimation = { x: 0, y: 0 };

  // decoder state vars
  private m_restbits = 0; // remaining valid bits
  private m_restbyte = 0; // remaining bytes in this block
  private m_lastbyte = 0; // last byte read
  private m_buffer = new Uint8Array(256); // buffer for reading
  private m_bufp = 0; // index of next byte in buffer

  /** `Destroy`: free all internal frames. */
  Destroy(): void {
    this.m_frames = [];
    this.m_nFrames = 0;
  }

  GetFrameCount(): number {
    return this.m_nFrames;
  }

  private GetFrame(aFrame: number): GIFImage {
    return this.m_frames[aFrame]!;
  }

  /** `ConvertToImage`: frame \a aFrame, its transparent index as bright pink and a mask of it. */
  ConvertToImage(aFrame: number, aImage: GIF_IMAGE_SINK): boolean {
    const frame = this.GetFrame(aFrame);

    // create the image
    if (!aImage.Create(frame.w, frame.h)) return false;

    const pal = frame.pal;
    const src = frame.p;
    const dst = aImage.GetData()!;
    const transparent = frame.transparent;

    // set transparent colour mask
    if (transparent !== -1) {
      // wxIMAGE_OPTION_GIF_TRANSPARENCY is never set by KiCad: the default, HIGHLIGHT.
      // By default, we assign bright pink to transparent pixels to make them perfectly
      // noticeable if someone accidentally draws the image without taking transparency into
      // account. Due to this use of pink, we need to change any existing image pixels with this
      // colour to use something different.
      for (let i = 0; i < frame.ncolours; i++) {
        if (pal[3 * i + 0] === 255 && pal[3 * i + 1] === 0 && pal[3 * i + 2] === 255)
          pal[3 * i + 2] = 254;
      }

      pal[3 * transparent + 0] = 255;
      pal[3 * transparent + 1] = 0;
      pal[3 * transparent + 2] = 255;

      aImage.SetMaskColour(255, 0, 255);
    } else {
      aImage.SetMask(false);
    }

    // copy image data
    const npixel = frame.w * frame.h;

    for (let i = 0, d = 0; i < npixel; i++) {
      const s = src[i]!;
      dst[d++] = pal[3 * s + 0]!;
      dst[d++] = pal[3 * s + 1]!;
      dst[d++] = pal[3 * s + 2]!;
    }

    return true;
  }

  /** `getcode`: the next code from the stream, \a aBits wide. */
  private getcode(aStream: wxMemoryInputStream, aBits: number, aAbFin: number): number {
    // get remaining bits from last byte read
    let mask = (1 << aBits) - 1;
    let code = (this.m_lastbyte >>> (8 - this.m_restbits)) & mask;

    // keep reading new bytes while needed
    while (aBits > this.m_restbits) {
      // if no bytes left in this block, read the next block
      if (this.m_restbyte === 0) {
        this.m_restbyte = aStream.GetC();

        // Some encoders are a bit broken: instead of issuing an end-of-image symbol (ab_fin)
        // they come up with a zero-length subblock!! We catch this here so that the decoder sees
        // an ab_fin code. We also need to check if the file doesn't end unexpectedly.
        if (aStream.Eof() || this.m_restbyte === 0) {
          code = aAbFin;
          break;
        }

        // prefetch data
        aStream.Read(this.m_buffer, this.m_restbyte);

        if (aStream.LastRead() !== this.m_restbyte) {
          code = aAbFin;
          return code;
        }

        this.m_bufp = 0;
      }

      // read next byte and isolate the bits we need
      this.m_lastbyte = this.m_buffer[this.m_bufp++]!;
      mask = (1 << (aBits - this.m_restbits)) - 1;
      code = code + ((this.m_lastbyte & mask) << this.m_restbits);
      this.m_restbyte--;

      // adjust total number of bits extracted from the buffer
      this.m_restbits = this.m_restbits + 8;
    }

    // find number of bits remaining for next code
    this.m_restbits = this.m_restbits - aBits;

    return code;
  }

  /** `dgif`: decode one frame, initial code size \a aBits; \a aInterl for an interlaced one. */
  private dgif(
    aStream: wxMemoryInputStream,
    aImg: GIFImage,
    aInterl: boolean,
    aBits: number,
  ): wxGIFErrorCode {
    const allocSize = 4096 + 1;
    const ab_prefix = new Int32Array(allocSize); // alphabet (prefixes)
    const ab_tail = new Int32Array(allocSize); // alphabet (tails)
    const stack = new Int32Array(allocSize); // decompression stack

    // these won't change
    const ab_clr = 1 << aBits; // clear code
    const ab_fin = (1 << aBits) + 1; // end of info code

    // these will change through the decompression process
    let ab_bits = aBits + 1; // actual symbol width, in bits
    let ab_free = (1 << aBits) + 2; // first free position in alphabet
    let ab_max = (1 << ab_bits) - 1; // last possible character in alphabet
    let lastcode = -1;
    let abcabca = -1;
    let pass = 1; // pass number in interlaced images
    let pos = 0; // index into decompression stack
    let x = 0;
    let y = 0; // position in image buffer
    let code: number;

    // reset decoder vars
    this.m_restbits = 0;
    this.m_restbyte = 0;
    this.m_lastbyte = 0;

    do {
      // get next code
      const readcode = this.getcode(aStream, ab_bits, ab_fin);
      code = readcode;

      // end of image?
      if (code === ab_fin) break;

      // reset alphabet?
      if (code === ab_clr) {
        // reset main variables
        ab_bits = aBits + 1;
        ab_free = (1 << aBits) + 2;
        ab_max = (1 << ab_bits) - 1;
        lastcode = -1;
        abcabca = -1;

        // skip to next code
        continue;
      }

      // unknown code: special case (like in ABCABCA)
      if (code >= ab_free) {
        code = lastcode; // take last string
        stack[pos++] = abcabca; // add first character
      }

      // build the string for this code in the stack
      while (code > ab_clr) {
        stack[pos++] = ab_tail[code]!;
        code = ab_prefix[code]!;

        // Don't overflow. This shouldn't happen with normal GIF files, the allocSize of 4096+1
        // is enough. This will only happen with badly formed GIFs.
        if (pos >= allocSize) return wxGIFErrorCode.wxGIF_INVFORMAT;
      }

      if (pos >= allocSize) return wxGIFErrorCode.wxGIF_INVFORMAT;

      stack[pos] = code; // push last code into the stack
      abcabca = code; // save for special case

      // make new entry in alphabet (only if NOT just cleared)
      if (lastcode !== -1) {
        // Normally, after the alphabet is full and can't grow any further (ab_free == 4096),
        // encoder should (must?) emit CLEAR to reset it. This checks whether we really got it,
        // otherwise the GIF is damaged.
        if (ab_free > ab_max) return wxGIFErrorCode.wxGIF_INVFORMAT;

        ab_prefix[ab_free] = lastcode;
        ab_tail[ab_free] = code;
        ab_free++;

        if (ab_free > ab_max && ab_bits < 12) {
          ab_bits++;
          ab_max = (1 << ab_bits) - 1;
        }
      }

      // dump stack data to the image buffer
      while (pos >= 0) {
        aImg.p[x + y * aImg.w] = stack[pos]! & 0xff; // (char) stack[pos]
        pos--;

        if (++x >= aImg.w) {
          x = 0;

          if (aInterl) {
            // support for interlaced images
            switch (pass) {
              case 1:
                y += 8;
                break;
              case 2:
                y += 8;
                break;
              case 3:
                y += 4;
                break;
              case 4:
                y += 2;
                break;
            }

            // loop until a valid y coordinate has been found, Or if the maximum number of passes
            // has been reached, exit the loop, and stop image decoding
            while (y >= aImg.h) {
              switch (++pass) {
                case 2:
                  y = 4;
                  break;
                case 3:
                  y = 2;
                  break;
                case 4:
                  y = 1;
                  break;
                default:
                  // an interlaced image 1 high, for one: stop decoding
                  y = 0;
                  pos = -1;
                  code = ab_fin;
                  break;
              }
            }
          } else {
            // non-interlaced
            y++;

            // Some broken encoders write a block byte count one too high, so decoding
            // continues past the image: stop at the last row.
            if (y >= aImg.h) {
              code = ab_fin;
              break;
            }
          }
        }
      }

      pos = 0;
      lastcode = readcode;
    } while (code !== ab_fin);

    return wxGIFErrorCode.wxGIF_OK;
  }

  /** `DoCanRead`: the stream starts "GIF". */
  private DoCanRead(aStream: wxMemoryInputStream): boolean {
    const buf = new Uint8Array(3);

    // if ( !stream.Read(buf, WXSIZEOF(buf)) ): wxStreamBase::operator! is !IsOk()
    if (!aStream.Read(buf, 3).IsOk()) return false;

    return buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46;
  }

  /** `wxAnimationDecoder::CanRead`: DoCanRead, with the stream position put back. */
  CanRead(aStream: wxMemoryInputStream): boolean {
    const posOld = aStream.TellI();
    const ok = this.DoCanRead(aStream);

    if (aStream.SeekI(posOld) === wxInvalidOffset) return false;

    return ok;
  }

  /**
   * `LoadGIF`: read and decode the frames - every one of an 89a file, the first of an 87a -
   * expanded to 8 bits a pixel with a 256-colour palette each.
   */
  LoadGIF(aStream: wxMemoryInputStream): wxGIFErrorCode {
    let global_ncolors = 0;
    let disposal: wxAnimationDisposal;
    let delay: number;
    let type = 0;
    const pal = new Uint8Array(768);
    const buf = new Uint8Array(16);
    let anim = true;

    // check GIF signature
    if (!this.CanRead(aStream)) return wxGIFErrorCode.wxGIF_INVFORMAT;

    // check for animated GIF support (ver. >= 89a)
    const headerSize = 3 + 3;
    aStream.Read(buf, headerSize);

    if (aStream.LastRead() !== headerSize) return wxGIFErrorCode.wxGIF_INVFORMAT;

    // memcmp(buf + 3, "89a", 3) < 0
    const v = [0x38, 0x39, 0x61];

    for (let i = 0; i < 3; i++) {
      if (buf[3 + i] !== v[i]) {
        if (buf[3 + i]! < v[i]!) anim = false;
        break;
      }
    }

    // read logical screen descriptor block (LSDB)
    const lsdbSize = 2 + 2 + 1 + 1 + 1;
    aStream.Read(buf, lsdbSize);

    if (aStream.LastRead() !== lsdbSize) return wxGIFErrorCode.wxGIF_INVFORMAT;

    this.m_szAnimation = { x: buf[0]! + 256 * buf[1]!, y: buf[2]! + 256 * buf[3]! };

    if (anim && (this.m_szAnimation.x === 0 || this.m_szAnimation.y === 0))
      return wxGIFErrorCode.wxGIF_INVFORMAT;

    // load global color map if available
    if ((buf[4]! & 0x80) === 0x80) {
      global_ncolors = 2 << (buf[4]! & 0x07);
      const numBytes = 3 * global_ncolors;
      aStream.Read(pal, numBytes);

      if (aStream.LastRead() !== numBytes) return wxGIFErrorCode.wxGIF_INVFORMAT;
    }

    // transparent colour, disposal method and delay default to unused
    let transparent = -1;
    disposal = wxAnimationDisposal.wxANIM_UNSPECIFIED;
    delay = -1;

    let done = false;

    while (!done) {
      type = asUnsignedChar(aStream.GetC());

      // If the end of file has been reached (or an error) and a ";" hasn't been encountered yet,
      // exit the loop; the next loop treats the file as truncated.
      if (aStream.Eof()) break;

      switch (type) {
        case GIF_MARKER_ENDOFDATA:
          done = true;
          break;

        case GIF_MARKER_EXT:
          switch (aStream.GetC()) {
            case GIF_MARKER_EXT_GRAPHICS_CONTROL: {
              // graphics control extension, parse it
              const gceSize = 6;
              aStream.Read(buf, gceSize);

              if (aStream.LastRead() !== gceSize) {
                this.Destroy();
                return wxGIFErrorCode.wxGIF_INVFORMAT;
              }

              // read delay and convert from 1/100 of a second to ms
              delay = 10 * (buf[2]! + 256 * buf[3]!);

              // read transparent colour index, if used
              transparent = buf[1]! & 0x01 ? buf[4]! : -1;

              // read disposal method
              disposal = ((buf[1]! & 0x1c) >> 2) - 1;
              break;
            }

            case GIF_MARKER_EXT_COMMENT: {
              // wxIMAGE_OPTION_GIF_COMMENT: read and skipped, nothing here reads it
              let len = aStream.GetC();

              while (len) {
                if (aStream.Eof()) {
                  done = true;
                  break;
                }

                const charbuf = new Uint8Array(len);
                aStream.Read(charbuf, len);

                if (aStream.LastRead() !== len) {
                  done = true;
                  break;
                }

                len = aStream.GetC();
              }
              break;
            }

            default: {
              // other extension, skip
              for (let i = aStream.GetC(); i !== 0; i = aStream.GetC()) {
                if (
                  aStream.Eof() ||
                  aStream.LastRead() === 0 ||
                  aStream.SeekI(i, wxSeekMode.wxFromCurrent) === wxInvalidOffset
                ) {
                  done = true;
                  break;
                }
              }
              break;
            }
          }
          break;

        case GIF_MARKER_SEP: {
          // allocate memory for IMAGEN struct. Every return below runs the scope guard,
          // Destroy(), and drops the frames already read.
          const pimg = new GIFImage();

          // fill in the data
          const idbSize = 2 + 2 + 2 + 2 + 1;
          aStream.Read(buf, idbSize);

          if (aStream.LastRead() !== idbSize) {
            this.Destroy();
            return wxGIFErrorCode.wxGIF_INVFORMAT;
          }

          pimg.left = buf[0]! + 256 * buf[1]!;
          pimg.top = buf[2]! + 256 * buf[3]!;
          pimg.w = buf[4]! + 256 * buf[5]!;
          pimg.h = buf[6]! + 256 * buf[7]!;

          if (anim) {
            // some GIF images specify incorrect animation size but we can still open them if we
            // fix up the animation size, see #9465
            if (this.m_nFrames === 0) {
              if (pimg.w > this.m_szAnimation.x) this.m_szAnimation.x = pimg.w;
              if (pimg.h > this.m_szAnimation.y) this.m_szAnimation.y = pimg.h;
            } else {
              // subsequent frames: check that we have valid size
              if (
                !pimg.w ||
                pimg.w > this.m_szAnimation.x ||
                !pimg.h ||
                pimg.h > this.m_szAnimation.y
              ) {
                this.Destroy();
                return wxGIFErrorCode.wxGIF_INVFORMAT;
              }
            }
          }

          const interl = (buf[8]! & 0x40) !== 0;

          pimg.transparent = transparent;
          pimg.disposal = disposal;
          pimg.delay = delay;

          // allocate memory for image and palette
          pimg.p = new Uint8Array(pimg.w * pimg.h);

          // load local color map if available, else use global map
          if ((buf[8]! & 0x80) === 0x80) {
            const local_ncolors = 2 << (buf[8]! & 0x07);
            const numBytes = 3 * local_ncolors;
            aStream.Read(pimg.pal, numBytes);
            pimg.ncolours = local_ncolors;

            if (aStream.LastRead() !== numBytes) {
              this.Destroy();
              return wxGIFErrorCode.wxGIF_INVFORMAT;
            }
          } else {
            pimg.pal.set(pal);
            pimg.ncolours = global_ncolors;
          }

          // get initial code size from first byte in raster data
          const bits = aStream.GetC();

          if (aStream.Eof() || bits <= 0) {
            this.Destroy();
            return wxGIFErrorCode.wxGIF_INVFORMAT;
          }

          // decode image
          const result = this.dgif(aStream, pimg, interl, bits);

          if (result !== wxGIFErrorCode.wxGIF_OK) {
            this.Destroy();
            return result;
          }

          // add the image to our frame array
          this.m_frames.push(pimg);
          this.m_nFrames++;

          // if this is not an animated GIF, exit after first image
          if (!anim) done = true;

          break;
        }
      }
    }

    if (this.m_nFrames === 0) {
      this.Destroy();
      return wxGIFErrorCode.wxGIF_INVFORMAT;
    }

    // try to read to the end of the stream
    while (type !== GIF_MARKER_ENDOFDATA) {
      if (!aStream.IsOk()) return wxGIFErrorCode.wxGIF_TRUNCATED;

      type = asUnsignedChar(aStream.GetC());

      switch (type) {
        case GIF_MARKER_EXT: {
          // extension type
          aStream.GetC();

          // skip all data
          for (let i = aStream.GetC(); i !== 0; i = aStream.GetC()) {
            if (
              aStream.Eof() ||
              aStream.LastRead() === 0 ||
              aStream.SeekI(i, wxSeekMode.wxFromCurrent) === wxInvalidOffset
            ) {
              this.Destroy();
              return wxGIFErrorCode.wxGIF_INVFORMAT;
            }
          }
          break;
        }

        case GIF_MARKER_SEP: {
          // image descriptor block
          const idbSize = 2 + 2 + 2 + 2 + 1;
          aStream.Read(buf, idbSize);

          if (aStream.LastRead() !== idbSize) {
            this.Destroy();
            return wxGIFErrorCode.wxGIF_INVFORMAT;
          }

          // local color map
          if ((buf[8]! & 0x80) === 0x80) {
            const local_ncolors = 2 << (buf[8]! & 0x07);
            const numBytes = 3 * local_ncolors;

            if (aStream.SeekI(numBytes, wxSeekMode.wxFromCurrent) === wxInvalidOffset) {
              this.Destroy();
              return wxGIFErrorCode.wxGIF_INVFORMAT;
            }
          }

          // initial code size
          aStream.GetC();

          if (aStream.Eof() || aStream.LastRead() === 0) {
            this.Destroy();
            return wxGIFErrorCode.wxGIF_INVFORMAT;
          }

          // skip all data
          for (let i = aStream.GetC(); i !== 0; i = aStream.GetC()) {
            if (
              aStream.Eof() ||
              aStream.LastRead() === 0 ||
              aStream.SeekI(i, wxSeekMode.wxFromCurrent) === wxInvalidOffset
            ) {
              this.Destroy();
              return wxGIFErrorCode.wxGIF_INVFORMAT;
            }
          }
          break;
        }

        default:
          // images are OK, but couldn't read to the end of the stream
          if (type !== GIF_MARKER_ENDOFDATA && type !== 0x00) return wxGIFErrorCode.wxGIF_TRUNCATED;

          break;
      }
    }

    return wxGIFErrorCode.wxGIF_OK;
  }
}
