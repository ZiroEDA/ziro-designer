// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Text and Shape properties for board graphics (DIALOG_TEXT_PROPERTIES,
 * DIALOG_SHAPE_PROPERTIES).
 */
import { describe, it, expect } from 'vitest';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { shapePointsUsed } from '@ziroeda/pcbnew/dialogs/dialog_shape_properties.js';

describe('shapePointsUsed', () => {
  it('names the points each kind owns', () => {
    expect(shapePointsUsed(SHAPE_T.SEGMENT)).toEqual({
      start: true,
      end: true,
      mid: false,
      center: false,
    });
    expect(shapePointsUsed(SHAPE_T.ARC)).toEqual({
      start: true,
      end: true,
      mid: true,
      center: false,
    });
    expect(shapePointsUsed(SHAPE_T.CIRCLE)).toEqual({
      start: false,
      end: true,
      mid: false,
      center: true,
    });
    expect(shapePointsUsed(SHAPE_T.POLY)).toEqual({
      start: false,
      end: false,
      mid: false,
      center: false,
    });
  });
});
