// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * How much board a reference image covers.
 * Counterparts: `BITMAP_BASE::GetSize`, `REFERENCE_IMAGE::GetBoundingBox` and
 * `PCB_REFERENCE_IMAGE::HitTest`.
 *
 * ## The image is centred on its position
 *
 * `(at …)` is the *middle* of the picture, not a corner — `GetBoundingBox`
 * builds the box from the centre outwards. Treating it as a top-left corner
 * would put every image half its own size out of place, consistently enough to
 * look deliberate.
 *
 * ## Pixels become board units through the file's own resolution
 *
 * A pixel spans `25.4 mm / ppi`, where ppi comes from the PNG's `pHYs` chunk
 * and falls back to `BITMAP_BASE`'s 300. That is then multiplied by `(scale …)`.
 * So the same picture at 600 ppi covers half the board that it does at 300, and
 * the scale factor is on top of that rather than instead of it.
 *
 * Board internal units are nanometres, which is why this cannot reuse the
 * schematic's IU-per-pixel: there an IU is 100 nm.
 *
 * There is no `hitTestImage` here. `boardHitCandidates` needs the *distance* to
 * the box for its size ranking rather than a boolean, so it measures against
 * `imageBBox` directly; a predicate was written and had no caller, so it is not
 * kept. Same call as the text box work.
 */
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { pngPPI, pngPixelSize } from '@ziroeda/common/src/png_meta.js';
import { pixelSizeIu } from '@ziroeda/common/src/reference_image.js';
import type { PcbImage } from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/**
 * The size a payload-less or unreadable image is given, so it stays selectable
 * rather than becoming an invisible zero-size item on the board.
 */
export const FALLBACK_PIXELS = { w: 40, h: 40 };

/**
 * The board's binding of `REFERENCE_IMAGE`, whose constructor takes the frame's
 * `EDA_IU_SCALE` (`PCB_REFERENCE_IMAGE::m_referenceImage`,
 * pcbnew/pcb_reference_image.h:138, is built with `pcbIUScale`). The arithmetic
 * is shared with the schematic, as `REFERENCE_IMAGE::updatePixelSizeInIU` is
 * upstream; only the scale is the board's.
 */
export function iuPerPixel(ppi: number): number {
  return pixelSizeIu(pcbIUScale, ppi);
}

/** `BITMAP_BASE::GetSize`: the image's extent in board IU. */
export function imageSizeIU(img: PcbImage): { w: number; h: number } {
  const px = pngPixelSize(img.data) ?? FALLBACK_PIXELS;
  const per = iuPerPixel(pngPPI(img.data));
  const scale = img.scale ?? 1;
  return { w: Math.round(px.w * per * scale), h: Math.round(px.h * per * scale) };
}

/**
 * `REFERENCE_IMAGE::GetBoundingBox`, which is `BOX2I::ByCenter(pos, size)` —
 * `BOX2(center - size / 2, size)`.
 *
 * The origin is offset by *truncating* division and the box is then exactly
 * `size` across. Halving and adding on both sides instead makes an odd size
 * come back one IU wider than the image really is — a nanometre, but it means
 * the box and `imageSizeIU` disagree, and something downstream eventually
 * cares which one it asked.
 */
export function imageBBox(img: PcbImage): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const { w, h } = imageSizeIU(img);
  const minX = img.at.x - Math.trunc(w / 2);
  const minY = img.at.y - Math.trunc(h / 2);
  return { minX, minY, maxX: minX + w, maxY: minY + h };
}
