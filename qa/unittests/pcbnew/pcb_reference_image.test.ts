// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_REFERENCE_IMAGE over REFERENCE_IMAGE and BITMAP_BASE
 * (`pcbnew/pcb_reference_image.cpp`, `common/reference_image.cpp`,
 * `common/bitmap_base.cpp`). The expected numbers were read from KiCad's own
 * `pcbnew` python module on a board carrying the PIL-made PNGs of
 * `qa/fixtures/png` (a 13x9 RGB at 100 dpi, and a 13x9 RGBA at scale 2);
 * the pixels after Flip + Rotate are what KiCad wrote back into the file
 * (`kicad_flip_rotate.json`, decoded by PIL).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_ids.js';
import { WX_IMAGE } from '@ziroeda/common/wx_image.js';
import { FLIP_DIRECTION } from '@ziroeda/core/src/mirror.js';
import { EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { PCB_REFERENCE_IMAGE } from '@ziroeda/pcbnew/pcb_reference_image.js';

const dir = new URL('../../fixtures/png/', import.meta.url);
const png = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`${name}.png`, dir))));
const kicad = JSON.parse(
  readFileSync(fileURLToPath(new URL('kicad_flip_rotate.json', dir)), 'utf8'),
) as Record<string, { w: number; h: number; rgba: string }>;

const box = (i: PCB_REFERENCE_IMAGE) => {
  const bb = i.GetBoundingBox();
  return [bb.GetX(), bb.GetY(), bb.GetWidth(), bb.GetHeight()];
};

const rgbaOf = (img: WX_IMAGE): string => {
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
  return Buffer.from(out).toString('base64');
};

function image(
  name: string,
  at: { x: number; y: number },
  layer: PCB_LAYER_ID,
  scale = 1,
): { b: BOARD; i: PCB_REFERENCE_IMAGE } {
  const b = new BOARD();
  const i = new PCB_REFERENCE_IMAGE(b, at, layer);
  expect(i.GetReferenceImage().ReadImageFile(png(name))).toBe(true);
  if (scale !== 1) i.SetImageScale(scale);
  b.Add(i);
  return { b, i };
}

describe('PCB_REFERENCE_IMAGE', () => {
  it('a 100 dpi PNG reads as 99 ppi (wx rounds the metres to dots/cm first); the box is centred on the position', () => {
    const { i } = image('rgb8_100dpi', { x: 10000000, y: 20000000 }, PCB_LAYER_ID.F_SilkS);
    expect(i.GetReferenceImage().GetImage().GetPPI()).toBe(99);
    expect(box(i)).toEqual([8332323, 18845454, 3335354, 2309091]);
    expect(i.GetPosition()).toEqual({ x: 10000000, y: 20000000 });
    expect(i.HitTest({ x: 10000000, y: 20000000 }, 0)).toBe(true);
    expect(i.HitTest({ x: 12000000, y: 20000000 }, 0)).toBe(false);
    expect(i.GetItemDescription(null, true)).toBe('Reference Image');

    // 150 dpi = 5905 px/m -> 59 dots/cm -> 59 x 2.54 = 149.86, KiROUNDed to 150 (truncated it would be 149)
    const { i: i150 } = image('rgb8_150dpi', { x: 10000000, y: 20000000 }, PCB_LAYER_ID.F_SilkS);
    expect(i150.GetReferenceImage().GetImage().GetPPI()).toBe(150);
    expect(box(i150)).toEqual([8899333, 19238000, 2201333, 1524000]);

    const { i: i2 } = image('rgba8', { x: 30000000, y: 40000000 }, PCB_LAYER_ID.Cmts_User, 2);
    expect(i2.GetReferenceImage().GetImage().GetPPI()).toBe(300);
    expect(box(i2)).toEqual([28899333, 39238000, 2201333, 1524000]);
  });

  it("Flip mirrors the position and the pixels; Rotate turns the pixels a quarter turn; the re-encoded PNG is KiCad's", () => {
    const { i } = image('rgb8_100dpi', { x: 10000000, y: 20000000 }, PCB_LAYER_ID.F_SilkS);
    i.Flip({ x: 0, y: 0 }, FLIP_DIRECTION.LEFT_RIGHT);
    expect(i.GetPosition()).toEqual({ x: -10000000, y: 20000000 });
    expect(i.GetLayer()).toBe(PCB_LAYER_ID.B_SilkS);
    expect(box(i)).toEqual([-11667677, 18845454, 3335354, 2309091]);
    expect(i.GetReferenceImage().GetImage().IsMirroredX()).toBe(true);

    i.Rotate({ x: 0, y: 0 }, new EDA_ANGLE(90, EDA_ANGLE_T.DEGREES_T));
    expect(i.GetPosition()).toEqual({ x: 20000000, y: 10000000 });
    expect(box(i)).toEqual([18845454, 8332323, 2309091, 3335354]);
    expect(i.GetReferenceImage().GetImage().Rotation().AsDegrees()).toBe(90);

    const saved = i.GetReferenceImage().GetImage().SaveImageData()!;
    const back = new WX_IMAGE();
    expect(back.LoadFile(saved)).toBe(true);
    const exp = kicad['20 10']!;
    expect([back.GetWidth(), back.GetHeight()]).toEqual([exp.w, exp.h]);
    expect(rgbaOf(back)).toBe(exp.rgba);
    // the resolution survives the rotation (wxImage::Rotate90 would drop it)
    expect(i.GetReferenceImage().GetImage().GetPPI()).toBe(99);

    const d = i.Duplicate(false) as PCB_REFERENCE_IMAGE;
    expect(i.Similarity(d)).toBe(1.0);
    expect(i.equals(d)).toBe(true);
  });

  it('an untouched image is written back byte for byte', () => {
    const { i } = image('rgba8', { x: 30000000, y: 40000000 }, PCB_LAYER_ID.Cmts_User, 2);
    expect(i.GetReferenceImage().GetImage().SaveImageData()).toEqual(png('rgba8'));
  });
});
