// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * wxImage::LoadFile( stream, wxBITMAP_TYPE_ANY ) through WX_IMAGE, against what the wxGTK 3.2 KiCad
 * links makes of the same bytes from a wxMemoryInputStream, as BITMAP_BASE reads them.
 * qa/data/wx/image/expected.json is written by qa/probes/gen_image_expectations.py from
 * qa/probes/wximage_load_oracle.cpp alone: the handler that read each file, its size, RGB, alpha,
 * mask colour and resolution options, and what every cut of a few files makes.
 *
 * GIF: wxGIFDecoder and wxGIFHandler - a transparent index is bright pink plus a mask of it, an
 * animation is its first frame, a truncated stream keeps the rows it got.
 *
 * BMP: wxBMPHandler::LoadDib and LoadBMPData - 1, 4 and 8 bits through the palette, RLE4 and
 * RLE8, 16 bits as 555 or by bitfields, 24, and 32 with alpha only when some pixel is not fully
 * transparent (a bitfields file's alpha mask is read and never used); OS/2 headers; bottom-up
 * and top-down; pixels per metre over 100 as dots per centimetre.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  WX_IMAGE,
  wxIMAGE_OPTION_RESOLUTIONUNIT,
  wxIMAGE_OPTION_RESOLUTIONX,
  wxIMAGE_OPTION_RESOLUTIONY,
} from '@ziroeda/wx/wx_image.js';
import { describe, expect, it } from 'vitest';

const DATA = resolve(__dirname, '../../data/wx/image');

interface LOADED {
  width: number;
  height: number;
  type: number;
  mask: [number, number, number] | null;
  resolution: [number, number, number];
  rgbSha256: string;
  alphaSha256: string | null;
}
/** What wx made of it: the image, null for a load that failed, or 'crash' where wx itself
 *  crashed (an RLE delta that leaves the image writes before wx's buffer - KiCad would crash). */
type OUTCOME = LOADED | null | 'crash';

const EXPECTED = JSON.parse(readFileSync(`${DATA}/expected.json`, 'utf8')) as {
  load: Record<string, OUTCOME>;
  truncations: Record<string, Record<string, OUTCOME>>;
};

/** Against wx's outcome: the same image or failure, or for a crash, only a return. */
function expectOutcome(aData: Uint8Array, aWant: OUTCOME) {
  if (aWant === 'crash') expect(() => loaded(aData)).not.toThrow();
  else expect(loaded(aData)).toEqual(aWant);
}

const sha256 = (aBytes: Uint8Array) => createHash('sha256').update(aBytes).digest('hex');
const file = (aName: string) => new Uint8Array(readFileSync(`${DATA}/${aName}`));

/** What a WX_IMAGE holds after LoadFile, in the oracle's terms. */
function loaded(aData: Uint8Array): LOADED | null {
  const image = new WX_IMAGE();

  if (!image.LoadFile(aData)) return null;

  return {
    width: image.GetWidth(),
    height: image.GetHeight(),
    type: image.GetType(),
    mask: image.HasMask() ? [image.GetMaskRed(), image.GetMaskGreen(), image.GetMaskBlue()] : null,
    resolution: [
      image.GetOptionInt(wxIMAGE_OPTION_RESOLUTIONX),
      image.GetOptionInt(wxIMAGE_OPTION_RESOLUTIONY),
      image.GetOptionInt(wxIMAGE_OPTION_RESOLUTIONUNIT),
    ],
    rgbSha256: sha256(image.GetData()!),
    alphaSha256: image.HasAlpha() ? sha256(image.GetAlpha()!) : null,
  };
}

const gifs = Object.entries(EXPECTED.load).filter(([n]) => n.endsWith('.gif'));

describe('wxGIFHandler', () => {
  it.each(gifs)('%s loads as wx loads it', (aName, aWant) => {
    expectOutcome(file(aName), aWant);
  });

  const cuts = Object.entries(EXPECTED.truncations)
    .filter(([n]) => n.endsWith('.gif'))
    .flatMap(([n, c]) => Object.entries(c).map(([len, want]) => [n, Number(len), want] as const));

  it.each(cuts)('%s cut to %i bytes: what wx makes of it', (aName, aLength, aWant) => {
    expectOutcome(file(aName).slice(0, aLength), aWant);
  });
});

const bmps = Object.entries(EXPECTED.load).filter(([n]) => n.endsWith('.bmp'));

describe('wxBMPHandler', () => {
  it.each(bmps)('%s loads as wx loads it', (aName, aWant) => {
    expectOutcome(file(aName), aWant);
  });

  const cuts = Object.entries(EXPECTED.truncations)
    .filter(([n]) => n.endsWith('.bmp'))
    .flatMap(([n, c]) => Object.entries(c).map(([len, want]) => [n, Number(len), want] as const));

  it.each(cuts)('%s cut to %i bytes: what wx makes of it', (aName, aLength, aWant) => {
    expectOutcome(file(aName).slice(0, aLength), aWant);
  });
});

describe('the mask through WX_IMAGE', () => {
  /** A 3 x 1 image: pink (the mask colour), (2, 0, 0) and (0, 0, 3), masked on pink. */
  function masked(): WX_IMAGE {
    const image = new WX_IMAGE();
    image.SetData(new Uint8Array([255, 0, 255, 2, 0, 0, 0, 0, 3]), 3, 1);
    image.SetMaskColour(255, 0, 255);
    return image;
  }

  it('ConvertToGreyscale rounds as wxColour::MakeGrey does, and leaves the mask colour alone', () => {
    // MakeGrey: (wxByte)wxRound( 0.299 r + 0.587 g + 0.114 b ). (2, 0, 0) is 0.598: 1, where a
    // truncation gives 0; (0, 0, 3) is 0.342: 0. DoMakeGrey skips a pixel of the mask colour.
    const grey = masked().ConvertToGreyscale();
    expect([...grey.GetData()!]).toEqual([255, 0, 255, 1, 1, 1, 0, 0, 0]);
    expect(grey.HasMask()).toBe(true);
  });

  it('Mirror and Rotate90 carry the mask colour, as MakeEmptyClone does', () => {
    for (const image of [masked().Mirror(), masked().Mirror(false), masked().Rotate90()]) {
      expect([
        image.HasMask(),
        image.GetMaskRed(),
        image.GetMaskGreen(),
        image.GetMaskBlue(),
      ]).toEqual([true, 255, 0, 255]);
    }
  });

  it('SaveFilePng writes the mask as alpha 0, the rest opaque', () => {
    // wxPNGHandler::SaveFile: bUseAlpha with a mask, uchAlpha 255 but 0 on the mask colour
    const back = new WX_IMAGE();
    expect(back.LoadFile(masked().SaveFilePng()!)).toBe(true);
    expect([...back.GetData()!]).toEqual([255, 0, 255, 2, 0, 0, 0, 0, 3]);
    expect([...back.GetAlpha()!]).toEqual([0, 255, 255]);
  });

  it('SetData and Create start without a mask', () => {
    const image = masked();
    image.Create(2, 2);
    expect(image.HasMask()).toBe(false);
  });
});
