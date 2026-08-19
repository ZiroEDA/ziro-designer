// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `REFERENCE_IMAGE::updatePixelSizeInIU` (common/reference_image.cpp:89-93):
 *
 *     const double pixelSizeIu = (double) m_iuScale.MilsToIU( 1000 ) / GetPPI();
 *
 * One implementation upstream, parameterised by the frame's EDA_IU_SCALE, which
 * is why the schematic and the board get different numbers out of the same code.
 * These cases pin both numbers, so a shared helper can never quietly become one
 * editor's constant.
 */
import { describe, expect, it } from 'vitest';
import { pcbIUScale, pixelSizeIu, schIUScale } from '@ziroeda/common';
import { iuPerPixel as schIuPerPixel } from '@ziroeda/eeschema/src/tools/image_size.js';
import { iuPerPixel as pcbIuPerPixel } from '@ziroeda/pcbnew/src/image_geometry.js';

describe('pixelSizeIu', () => {
  it('is an inch of the given scale over the resolution', () => {
    // schIUScale.MilsToIU(1000) is 254000, the number BITMAP_BASE's constructor
    // hardcodes; pcbIUScale.MilsToIU(1000) is 25400000, a hundred times more.
    expect(pixelSizeIu(schIUScale, 300)).toBeCloseTo(254000 / 300, 9);
    expect(pixelSizeIu(pcbIUScale, 300)).toBeCloseTo(25_400_000 / 300, 6);
    expect(pixelSizeIu(schIUScale, 96)).toBeCloseTo(254000 / 96, 9);
  });

  it('keeps the two editors a hundred apart, never a shared constant', () => {
    expect(pixelSizeIu(pcbIUScale, 150) / pixelSizeIu(schIUScale, 150)).toBeCloseTo(100, 9);
  });
});

describe('each editor binds it to its own scale', () => {
  it('the schematic to schIUScale', () => {
    for (const ppi of [72, 96, 300, 600]) {
      expect(schIuPerPixel(ppi)).toBeCloseTo(pixelSizeIu(schIUScale, ppi), 9);
    }
  });

  it('the board to pcbIUScale', () => {
    for (const ppi of [72, 96, 300, 600]) {
      expect(pcbIuPerPixel(ppi)).toBeCloseTo(pixelSizeIu(pcbIUScale, ppi), 6);
    }
  });
});
