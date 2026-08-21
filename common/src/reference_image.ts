// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The scale that turns an image's pixels into an editor's internal units.
 * Counterpart: `REFERENCE_IMAGE::updatePixelSizeInIU`, `common/reference_image.cpp:89-93`.
 *
 * Both editors' image items own a `REFERENCE_IMAGE` — `SCH_BITMAP::m_referenceImage`
 * (eeschema/sch_bitmap.h:137) and `PCB_REFERENCE_IMAGE::m_referenceImage`
 * (pcbnew/pcb_reference_image.h:138) — and that one class in `common/` computes the
 * pixel size for both. It is not duplicated upstream; it is *parameterised*, by the
 * `EDA_IU_SCALE` the item is constructed with, and the same parameterisation is what
 * makes one implementation correct here too.
 *
 * A word of warning, because it is the obvious wrong turn: `BITMAP_BASE`'s
 * constructor (common/bitmap_base.cpp:51) hardcodes `254000.0 / m_ppi` under a
 * comment saying so is "OK ... for Eeschema which uses currently 254000PPI". That
 * is only the default a bare BITMAP_BASE carries before anyone sets it, and
 * REFERENCE_IMAGE overwrites it in its constructor. Copying that literal into
 * shared code would be wrong on a board by a factor of a hundred. Take the scale,
 * never the number.
 */
import type { EdaIuScale } from './eda_units.js';

/**
 * `REFERENCE_IMAGE::updatePixelSizeInIU`: the internal units one image pixel spans,
 * `m_iuScale.MilsToIU( 1000 ) / m_bitmapBase->GetPPI()`.
 *
 * A thousand mils is an inch, so this is IU-per-inch over pixels-per-inch —
 * 254000/ppi for the schematic, 25400000/ppi for the board.
 *
 * There is no guard on the resolution, and upstream needs none:
 * `BITMAP_BASE::updatePPI` (common/bitmap_base.cpp:113-125) only takes a
 * resolution out of the file when it is greater than one, so `GetPPI()` is never
 * zero. Our PNG reader upholds the same invariant.
 */
export function pixelSizeIu(aIuScale: EdaIuScale, aPPI: number): number {
  return aIuScale.milsToIU(1000) / aPPI;
}

/**
 * `BITMAP_BASE::GetSize()` (common/bitmap_base.cpp:416-427): the internal units
 * an image spans along one axis, `pixels * GetScalingFactor()`, where
 * `GetScalingFactor()` is `m_pixelSizeIu * m_scale` (include/bitmap_base.h).
 *
 * The `* scale` is the half of it that is easy to drop, and dropping it is
 * invisible until someone scales an image: a caller that sizes a bitmap by
 * `pixels / ppi` alone agrees with this one only while the scale is 1. That is
 * exactly how the drawing sheet came to draw a scaled image at one size and
 * hit-test it at another.
 */
export function bitmapSizeIu(
  aIuScale: EdaIuScale,
  aPixels: number,
  aPPI: number,
  aScale: number,
): number {
  return aPixels * pixelSizeIu(aIuScale, aPPI) * aScale;
}
