// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `qa/tests/common/test_text_attributes.cpp`, transcribed (minus the `std::hash` checks). */
import { describe, expect, it } from 'vitest';
import { FONT } from '@ziroeda/common/font/font.js';
import '@ziroeda/common/font/stroke_font.js';
import {
  GR_TEXT_H_ALIGN_T,
  GR_TEXT_V_ALIGN_T,
  TEXT_ATTRIBUTES,
} from '@ziroeda/common/font/text_attributes.js';
import { COLOR4D_UNSPECIFIED, LEGACY_COLORS } from '@ziroeda/common/color4d.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';

describe('TextAttributes', () => {
  it('Compare', () => {
    const a = new TEXT_ATTRIBUTES();
    const b = new TEXT_ATTRIBUTES();

    expect(a.equals(b)).toBe(true);

    a.m_Font = FONT.GetFont();
    expect(a.gt(b)).toBe(true);

    a.m_Font = null;
    b.m_Font = FONT.GetFont();
    expect(a.lt(b)).toBe(true);

    b.m_Font = null;
    a.m_Halign = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT;
    expect(a.gt(b)).toBe(true);

    a.m_Halign = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER;
    b.m_Halign = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT;
    expect(a.lt(b)).toBe(true);

    b.m_Halign = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER;
    a.m_Valign = GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM;
    expect(a.gt(b)).toBe(true);

    a.m_Valign = GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER;
    b.m_Valign = GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM;
    expect(a.lt(b)).toBe(true);

    b.m_Valign = GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER;
    a.m_Angle = new EDA_ANGLE(90.0);
    expect(a.gt(b)).toBe(true);

    a.m_Angle = new EDA_ANGLE(0.0);
    b.m_Angle = new EDA_ANGLE(90.0);
    expect(a.lt(b)).toBe(true);

    b.m_Angle = new EDA_ANGLE(0.0);
    a.m_StrokeWidth = 1;
    expect(a.gt(b)).toBe(true);

    a.m_StrokeWidth = 0;
    b.m_StrokeWidth = 1;
    expect(a.lt(b)).toBe(true);

    b.m_StrokeWidth = 0;
    a.m_Italic = true;
    expect(a.gt(b)).toBe(true);

    a.m_Italic = false;
    b.m_Italic = true;
    expect(a.lt(b)).toBe(true);

    b.m_Italic = false;
    a.m_Bold = true;
    expect(a.gt(b)).toBe(true);

    a.m_Bold = false;
    b.m_Bold = true;
    expect(a.lt(b)).toBe(true);

    b.m_Bold = false;
    a.m_Underlined = true;
    expect(a.gt(b)).toBe(true);

    a.m_Underlined = false;
    b.m_Underlined = true;
    expect(a.lt(b)).toBe(true);

    b.m_Underlined = false;
    a.m_Color = LEGACY_COLORS.RED;
    expect(a.gt(b)).toBe(true);

    a.m_Color = COLOR4D_UNSPECIFIED;
    b.m_Color = LEGACY_COLORS.RED;
    expect(a.lt(b)).toBe(true);

    b.m_Color = COLOR4D_UNSPECIFIED;
    a.m_Mirrored = true;
    expect(a.gt(b)).toBe(true);

    a.m_Mirrored = false;
    b.m_Mirrored = true;
    expect(a.lt(b)).toBe(true);

    b.m_Mirrored = false;
    b.m_Multiline = false;
    expect(a.gt(b)).toBe(true);

    b.m_Multiline = true;
    a.m_Multiline = false;
    expect(a.lt(b)).toBe(true);

    a.m_Multiline = true;
    a.m_Size.x = 1;
    expect(a.gt(b)).toBe(true);

    a.m_Size.x = 0;
    b.m_Size.x = 1;
    expect(a.lt(b)).toBe(true);

    b.m_Size.x = 0;
    a.m_KeepUpright = true;
    expect(a.gt(b)).toBe(true);

    a.m_KeepUpright = false;
    b.m_KeepUpright = true;
    expect(a.lt(b)).toBe(true);

    b.m_KeepUpright = false;
  });
});
