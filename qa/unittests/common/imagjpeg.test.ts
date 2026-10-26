// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * wxJPEGHandler through WX_IMAGE and BITMAP_BASE, against what wx's own libjpeg calls give with the
 * libjpeg-turbo KiCad links. qa/data/wx/jpeg/expected.json is written by
 * qa/probes/gen_jpeg_expectations.py from qa/probes/wxjpeg_oracle.c and wxjpeg_enc_oracle.c,
 * built against the system libjpeg: none of it comes from our code.
 *
 * - Every layout decodes to the same RGB, byte for byte: baseline and progressive, 4:2:0 and
 *   4:4:4, grey, CMYK (through wx_cmyk_to_rgb), a truncated file (wx's fake EOI finishes it),
 *   and a phone photo with an EXIF orientation, which wx 3.2 does not apply.
 * - A JFIF marker's density becomes the resolution options whatever its unit, 0 included, so
 *   BITMAP_BASE::updatePPI reads 72 PPI from a unitless 72 x 72.
 * - SaveFile writes the same stream libjpeg's defaults write, with the quality option and the
 *   resolution options as the JFIF density. BITMAP_BASE reaches it only through SetImageType,
 *   which nothing in KiCad 10.0.6 calls: an edited JPEG is re-encoded as a PNG.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BITMAP_BASE } from '@ziroeda/common/bitmap_base.js';
import {
  WX_IMAGE,
  wxBitmapType,
  wxImageResolution,
  wxInitAllImageHandlers,
  wxIMAGE_OPTION_QUALITY,
  wxIMAGE_OPTION_RESOLUTION,
  wxIMAGE_OPTION_RESOLUTIONUNIT,
  wxIMAGE_OPTION_RESOLUTIONX,
  wxIMAGE_OPTION_RESOLUTIONY,
} from '@ziroeda/wx/wx_image.js';
import { beforeAll, describe, expect, it } from 'vitest';

const DATA = resolve(__dirname, '../../data/wx/jpeg');

interface DECODED {
  width: number;
  height: number;
  rgbSha256: string;
  sawJFIF: boolean;
  densityUnit: number;
  xDensity: number;
  yDensity: number;
}
interface ENCODED {
  width: number;
  height: number;
  args: string[];
  length: number;
  sha256: string;
}
const EXPECTED = JSON.parse(readFileSync(`${DATA}/expected.json`, 'utf8')) as {
  decode: Record<string, DECODED>;
  encode: Record<string, ENCODED>;
  truncationsOf: string;
  /** Prefix length -> the RGB's sha256, or null where libjpeg gives up. */
  truncations: Record<string, string | null>;
};

const sha256 = (aBytes: Uint8Array) => createHash('sha256').update(aBytes).digest('hex');
const file = (aName: string) => new Uint8Array(readFileSync(`${DATA}/${aName}`));

/** The encoder's input, the formula gen_jpeg_expectations.py fed the oracle. */
function pattern(aWidth: number, aHeight: number): Uint8Array {
  const rgb = new Uint8Array(aWidth * aHeight * 3);
  for (let i = 0; i < aWidth * aHeight; i++)
    for (let c = 0; c < 3; c++) rgb[i * 3 + c] = (i * (c + 3) * 7 + (i >> 4) * 13) & 255;
  return rgb;
}

// test_bitmap_base.cpp registers the handlers itself: a test is not a program with an InitPgm.
beforeAll(() => wxInitAllImageHandlers());

describe('wxJPEGHandler::LoadFile', () => {
  it.each(Object.entries(EXPECTED.decode))('%s decodes as libjpeg does', (aName, aWant) => {
    const image = new WX_IMAGE();

    expect(image.LoadFile(file(aName))).toBe(true);
    expect([image.GetWidth(), image.GetHeight()]).toEqual([aWant.width, aWant.height]);
    expect(sha256(image.GetData()!)).toBe(aWant.rgbSha256);
    expect(image.HasAlpha()).toBe(false);

    // wx sets the three options only when libjpeg saw a JFIF marker, and then as it saw them.
    expect(image.HasOption(wxIMAGE_OPTION_RESOLUTIONX)).toBe(aWant.sawJFIF);

    if (aWant.sawJFIF) {
      expect([
        image.GetOptionInt(wxIMAGE_OPTION_RESOLUTIONUNIT),
        image.GetOptionInt(wxIMAGE_OPTION_RESOLUTIONX),
        image.GetOptionInt(wxIMAGE_OPTION_RESOLUTIONY),
      ]).toEqual([aWant.densityUnit, aWant.xDensity, aWant.yDensity]);
    }
  });

  it('a header with no frame after it does not load, and returns', () => {
    // libjpeg's error_exit: wx_error_exit longjmps back out of it. Built with clang -O2 this hung
    // once, reading a stale cinfo after the jump; the libjpeg state is static for that.
    const noFrame = file('baseline_420.jpg').slice(0, 40);
    noFrame.fill(0, 20);
    expect(new WX_IMAGE().LoadFile(noFrame)).toBe(false);
  });

  it.each(
    Object.entries(EXPECTED.truncations),
  )('the first %s bytes fail or decode exactly as libjpeg has them', (aLength, aWant) => {
    const image = new WX_IMAGE();
    const loaded = image.LoadFile(file(EXPECTED.truncationsOf).slice(0, Number(aLength)));

    expect(loaded).toBe(aWant !== null);

    if (aWant !== null) expect(sha256(image.GetData()!)).toBe(aWant);
  });
});

describe('BITMAP_BASE on a JPEG', () => {
  const ppi = (aName: string) => {
    const bitmap = new BITMAP_BASE();
    expect(bitmap.ReadImageFile(file(aName))).toBe(true);
    return bitmap.GetPPI();
  };

  it('updatePPI reads a unitless JFIF density as dots per inch, and a per-cm one x 2.54', () => {
    expect(ppi('jfif_unitless_72.jpg')).toBe(72);
    expect(ppi('jfif_cm_118.jpg')).toBe(300); // KiROUND( 118 * 2.54 )
    expect(ppi('baseline_420.jpg')).toBe(300); // a density of 1 is no density: the default stays
  });

  it('the drawn pixels are the decoded ones', () => {
    const bitmap = new BITMAP_BASE();
    bitmap.ReadImageFile(file('progressive_422.jpg'));
    expect(sha256(bitmap.GetImageData()!.GetData()!)).toBe(
      EXPECTED.decode['progressive_422.jpg']!.rgbSha256,
    );
  });

  it('keeps the bytes it read until the image changes, then saves it as a PNG', () => {
    const bytes = file('baseline_420.jpg');
    const bitmap = new BITMAP_BASE();
    bitmap.ReadImageFile(bytes);
    expect(sha256(bitmap.SaveImageData()!)).toBe(sha256(bytes));

    bitmap.Rotate(false);
    const saved = bitmap.SaveImageData()!;
    // ReadImageFile never sets m_imageType, so it is INVALID and SaveImageData takes the PNG
    // branch: KiCad turns a rotated photo into a PNG.
    expect(bitmap.GetImageType()).toBe(wxBitmapType.wxBITMAP_TYPE_INVALID);
    expect([...saved.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

    // ...and reading it back gives the rotated size.
    const again = new WX_IMAGE();
    expect(again.LoadFile(saved)).toBe(true);
    expect([again.GetWidth(), again.GetHeight()]).toEqual([23, 37]);
    expect(again.GetType()).toBe(wxBitmapType.wxBITMAP_TYPE_PNG);
  });
});

describe('BITMAP_BASE::LoadLegacyData on a JPEG', () => {
  it('re-encodes the hex block as the image type says, a JPEG here', () => {
    // updateImageDataBuffer's only caller: SaveFile( wxBITMAP_TYPE_JPEG ) when the type is JPEG
    const bitmap = new BITMAP_BASE();
    bitmap.SetImageType(wxBitmapType.wxBITMAP_TYPE_JPEG);
    const hex = [...file('baseline_420.jpg')].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    expect(bitmap.LoadLegacyData([hex, 'EndData'][Symbol.iterator]()).ok).toBe(true);

    const saved = bitmap.SaveImageData()!;
    expect([...saved.slice(0, 4)]).toEqual([0xff, 0xd8, 0xff, 0xe0]);
    const again = new WX_IMAGE();
    expect(again.LoadFile(saved)).toBe(true);
    expect(again.GetType()).toBe(wxBitmapType.wxBITMAP_TYPE_JPEG);
  });
});

describe('wxJPEGHandler::SaveFile', () => {
  const options: Record<string, (aImage: WX_IMAGE) => void> = {
    defaults_37x23: () => {},
    defaults_64x48: () => {},
    quality90_37x23: (i) => i.SetOption(wxIMAGE_OPTION_QUALITY, 90),
    inches300_37x23: (i) => {
      i.SetOption(wxIMAGE_OPTION_RESOLUTIONUNIT, wxImageResolution.wxIMAGE_RESOLUTION_INCHES);
      i.SetOption(wxIMAGE_OPTION_RESOLUTIONX, 300);
      i.SetOption(wxIMAGE_OPTION_RESOLUTIONY, 300);
    },
    cm118_37x23: (i) => {
      i.SetOption(wxIMAGE_OPTION_RESOLUTIONUNIT, wxImageResolution.wxIMAGE_RESOLUTION_CM);
      i.SetOption(wxIMAGE_OPTION_RESOLUTIONX, 118);
      i.SetOption(wxIMAGE_OPTION_RESOLUTIONY, 118);
    },
    // what a unitless JFIF file loads as: GetResolutionFromOptions takes unit 0 as inches
    unitless72_37x23: (i) => {
      i.SetOption(wxIMAGE_OPTION_RESOLUTIONUNIT, 0);
      i.SetOption(wxIMAGE_OPTION_RESOLUTIONX, 72);
      i.SetOption(wxIMAGE_OPTION_RESOLUTIONY, 72);
    },
    single150_37x23: (i) => i.SetOption(wxIMAGE_OPTION_RESOLUTION, 150),
  };

  it.each(Object.entries(EXPECTED.encode))('%s writes what libjpeg writes', (aKey, aWant) => {
    const image = new WX_IMAGE();
    image.SetData(pattern(aWant.width, aWant.height), aWant.width, aWant.height);
    options[aKey]!(image);

    const out = image.SaveFileJpeg()!;
    expect(out.length).toBe(aWant.length);
    expect(sha256(out)).toBe(aWant.sha256);
  });
});
