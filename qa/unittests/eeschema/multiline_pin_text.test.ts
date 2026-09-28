// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ComputeMultiLinePinNumberLayout` (multiline_pin_text.cpp): detects a
 * brace-wrapped, newline-separated pin-number string and lays out the
 * (trimmed) lines with an alignment-dependent origin shift.
 */
import {
  GR_TEXT_H_ALIGN_T,
  GR_TEXT_V_ALIGN_T,
  TEXT_ATTRIBUTES,
} from '@ziroeda/common/font/text_attributes.js';
import { ANGLE_VERTICAL } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { ComputeMultiLinePinNumberLayout } from '@ziroeda/eeschema/multiline_pin_text.js';
import { describe, expect, it } from 'vitest';

function attrs(overrides: Partial<TEXT_ATTRIBUTES> = {}): TEXT_ATTRIBUTES {
  const a = new TEXT_ATTRIBUTES();
  a.m_Size = { x: 50, y: 50 };
  Object.assign(a, overrides);
  return a;
}

describe('ComputeMultiLinePinNumberLayout', () => {
  it('is not multi-line when the text is not brace-wrapped', () => {
    const layout = ComputeMultiLinePinNumberLayout('12', { x: 0, y: 0 }, attrs());
    expect(layout.m_IsMultiLine).toBe(false);
    expect(layout.m_Lines).toEqual([]);
  });

  it('is not multi-line when brace-wrapped but on a single line', () => {
    const layout = ComputeMultiLinePinNumberLayout('[12]', { x: 0, y: 0 }, attrs());
    expect(layout.m_IsMultiLine).toBe(false);
  });

  it('parses a brace-wrapped, newline-separated list and trims each line', () => {
    const layout = ComputeMultiLinePinNumberLayout('[ 1 \n2\n 3]', { x: 100, y: 200 }, attrs());
    expect(layout.m_IsMultiLine).toBe(true);
    expect(layout.m_Lines).toEqual(['1', '2', '3']);
    // KiROUND( 50 * 1.3 ) = 65
    expect(layout.m_LineSpacing).toBe(65);
  });

  it('shifts the start position along X for vertical text, by alignment', () => {
    const left = ComputeMultiLinePinNumberLayout(
      '[1\n2\n3]',
      { x: 1000, y: 500 },
      attrs({ m_Angle: ANGLE_VERTICAL, m_Halign: GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT }),
    );
    expect(left.m_StartPos).toEqual({ x: 1000, y: 500 });

    // totalWidth = (3-1) * 65 = 130
    const right = ComputeMultiLinePinNumberLayout(
      '[1\n2\n3]',
      { x: 1000, y: 500 },
      attrs({ m_Angle: ANGLE_VERTICAL, m_Halign: GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT }),
    );
    expect(right.m_StartPos).toEqual({ x: 870, y: 500 });

    const center = ComputeMultiLinePinNumberLayout(
      '[1\n2\n3]',
      { x: 1000, y: 500 },
      attrs({ m_Angle: ANGLE_VERTICAL, m_Halign: GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER }),
    );
    expect(center.m_StartPos).toEqual({ x: 1000 - 65, y: 500 });
  });

  it('shifts the start position along Y for horizontal text, by alignment', () => {
    // totalHeight = (3-1) * 65 = 130
    const bottom = ComputeMultiLinePinNumberLayout(
      '[1\n2\n3]',
      { x: 1000, y: 500 },
      attrs({ m_Valign: GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM }),
    );
    expect(bottom.m_StartPos).toEqual({ x: 1000, y: 370 });

    const center = ComputeMultiLinePinNumberLayout(
      '[1\n2\n3]',
      { x: 1000, y: 500 },
      attrs({ m_Valign: GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER }),
    );
    expect(center.m_StartPos).toEqual({ x: 1000, y: 500 - 65 });

    const top = ComputeMultiLinePinNumberLayout(
      '[1\n2\n3]',
      { x: 1000, y: 500 },
      attrs({ m_Valign: GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP }),
    );
    expect(top.m_StartPos).toEqual({ x: 1000, y: 500 });
  });

  it('truncates an odd half-shift toward zero, like C++ int division', () => {
    // 2 lines -> totalHeight = 1 * 65 = 65 (odd); C++ `65 / 2` truncates to 32.
    const layout = ComputeMultiLinePinNumberLayout(
      '[1\n2]',
      { x: 0, y: 500 },
      attrs({ m_Valign: GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER }),
    );
    expect(layout.m_StartPos.y).toBe(500 - 32);
  });
});
