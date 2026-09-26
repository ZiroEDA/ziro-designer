// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * WX_IMAGE's PNG reader (inflate + every colour type / bit depth / Adam7),
 * checked pixel for pixel against PIL's decode of the same files
 * (`qa/fixtures/png/expected.json`, written by the script that made them),
 * and the wxImage transforms.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  WX_IMAGE,
  wxIMAGE_OPTION_RESOLUTIONUNIT,
  wxIMAGE_OPTION_RESOLUTIONX,
  wxImageResolution,
} from '@ziroeda/common/wx_image.js';

const dir = new URL('../../fixtures/png/', import.meta.url);
const expected = JSON.parse(
  readFileSync(fileURLToPath(new URL('expected.json', dir)), 'utf8'),
) as Record<string, { w: number; h: number; rgba: string }>;

const load = (name: string): WX_IMAGE => {
  const img = new WX_IMAGE();
  expect(
    img.LoadFile(new Uint8Array(readFileSync(fileURLToPath(new URL(`${name}.png`, dir))))),
  ).toBe(true);
  return img;
};

const rgbaOf = (img: WX_IMAGE): Uint8Array => {
  const n = img.GetWidth() * img.GetHeight();
  const out = new Uint8Array(n * 4);
  const rgb = img.GetData()!;
  const alpha = img.GetAlpha();
  for (let i = 0; i < n; i++) {
    out[i * 4] = rgb[i * 3]!;
    out[i * 4 + 1] = rgb[i * 3 + 1]!;
    out[i * 4 + 2] = rgb[i * 3 + 2]!;
    out[i * 4 + 3] = alpha ? alpha[i]! : 255;
  }
  return out;
};

describe('WX_IMAGE PNG decoding', () => {
  for (const name of Object.keys(expected)) {
    it(`decodes ${name} to PIL's pixels`, () => {
      const img = load(name);
      const exp = expected[name]!;
      expect([img.GetWidth(), img.GetHeight()]).toEqual([exp.w, exp.h]);
      expect(Buffer.from(rgbaOf(img)).toString('base64')).toBe(exp.rgba);
    });
  }

  it('reads pHYs the wxPNGHandler way: metres to dots per cm by integer division', () => {
    const img = load('rgb8_100dpi');
    // 100 dpi = 3937 px/m -> 39 dots/cm (not 39.37)
    expect(img.GetOptionInt(wxIMAGE_OPTION_RESOLUTIONX)).toBe(39);
    expect(img.GetOptionInt(wxIMAGE_OPTION_RESOLUTIONUNIT)).toBe(
      wxImageResolution.wxIMAGE_RESOLUTION_CM,
    );
    expect(load('rgb8').GetOptionInt(wxIMAGE_OPTION_RESOLUTIONX)).toBe(0);
  });

  it('SaveFilePng round-trips the pixels and the resolution', () => {
    const img = load('rgba8');
    const bytes = img.SaveFilePng()!;
    const back = new WX_IMAGE();
    expect(back.LoadFile(bytes)).toBe(true);
    expect(rgbaOf(back)).toEqual(rgbaOf(img));

    const dpi = load('rgb8_100dpi');
    const back2 = new WX_IMAGE();
    expect(back2.LoadFile(dpi.SaveFilePng()!)).toBe(true);
    expect(back2.GetOptionInt(wxIMAGE_OPTION_RESOLUTIONX)).toBe(39);
  });

  it('Rotate90 clockwise puts the top row on the right; ConvertToGreyscale truncates the weighted sum', () => {
    const img = new WX_IMAGE(2, 1);
    const d = img.GetData()!;
    d.set([10, 20, 30, 200, 210, 220]);
    const r = img.Rotate90(true);
    expect([r.GetWidth(), r.GetHeight()]).toEqual([1, 2]);
    expect(Array.from(r.GetData()!)).toEqual([10, 20, 30, 200, 210, 220]); // (0,0) -> (0,0); (1,0) -> (0,1)
    const l = img.Rotate90(false);
    expect(Array.from(l.GetData()!)).toEqual([200, 210, 220, 10, 20, 30]);

    const g = img.ConvertToGreyscale();
    // 0.299*10 + 0.587*20 + 0.114*30 = 18.15 -> 18; 0.299*200 + 0.587*210 + 0.114*220 = 208.15 -> 208
    expect(Array.from(g.GetData()!)).toEqual([18, 18, 18, 208, 208, 208]);
  });
});
