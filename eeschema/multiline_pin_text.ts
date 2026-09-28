// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/multiline_pin_text.cpp`/`.h`: layout for a (possibly)
 * brace-wrapped, newline-separated stacked pin-number string, e.g.
 * `"[1\n2\n3]"` rendered as three lines stacked along the text's secondary
 * axis instead of one line reading "[1\n2\n3]" literally.
 *
 * No caller uses this yet — nothing in this tree currently builds a
 * multi-line pin-number string to feed it (`sch_pin.ts`'s pin-number text is
 * always a single line). Ported so the layout math exists once the format is
 * produced somewhere, rather than reinvented per-caller later.
 */

import { ANGLE_VERTICAL } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import {
  GR_TEXT_H_ALIGN_T,
  GR_TEXT_V_ALIGN_T,
  type TEXT_ATTRIBUTES,
} from '@ziroeda/common/font/text_attributes.js';

/** A 2D point in IU; `VECTOR2D` upstream, kept integral like the rest of this codebase. */
export interface MultilinePinTextPos {
  x: number;
  y: number;
}

/** `MULTILINE_PIN_TEXT_LAYOUT` (multiline_pin_text.h). */
export interface MULTILINE_PIN_TEXT_LAYOUT {
  /** true if brace-wrapped multi-line stacked list */
  m_IsMultiLine: boolean;
  /** individual numbered lines (trimmed) */
  m_Lines: string[];
  /** position used for line index 0 after alignment shift */
  m_StartPos: MultilinePinTextPos;
  /** inter-line spacing in IU (along secondary axis) */
  m_LineSpacing: number;
}

/**
 * Compute layout for a (possibly) multi-line stacked pin number string. If
 * not multi-line, the returned layout has `m_IsMultiLine = false` and no
 * further adjustments are required.
 */
export function ComputeMultiLinePinNumberLayout(
  aText: string,
  aAnchorPos: MultilinePinTextPos,
  aAttrs: TEXT_ATTRIBUTES,
): MULTILINE_PIN_TEXT_LAYOUT {
  const layout: MULTILINE_PIN_TEXT_LAYOUT = {
    m_IsMultiLine: false,
    m_Lines: [],
    m_StartPos: { x: aAnchorPos.x, y: aAnchorPos.y },
    m_LineSpacing: 0,
  };

  if (!(aText.startsWith('[') && aText.endsWith(']') && aText.includes('\n'))) {
    return layout; // not multi-line stacked
  }

  const content = aText.slice(1, aText.length - 1);
  const lines = content.split('\n');

  if (lines.length <= 1) return layout;

  layout.m_IsMultiLine = true;
  layout.m_Lines = lines.map((line) => line.trim());
  layout.m_LineSpacing = KiROUND(aAttrs.m_Size.y * 1.3);

  // Apply alignment-dependent origin shift identical to sch_painter logic
  if (aAttrs.m_Angle.equals(ANGLE_VERTICAL)) {
    const totalWidth = (layout.m_Lines.length - 1) * layout.m_LineSpacing;
    if (aAttrs.m_Halign === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT) {
      layout.m_StartPos = { x: layout.m_StartPos.x - totalWidth, y: layout.m_StartPos.y };
    } else if (aAttrs.m_Halign === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER) {
      // `totalWidth / 2` is C++ int division (truncates toward zero), not a round.
      layout.m_StartPos = {
        x: layout.m_StartPos.x - Math.trunc(totalWidth / 2),
        y: layout.m_StartPos.y,
      };
    }
  } else {
    const totalHeight = (layout.m_Lines.length - 1) * layout.m_LineSpacing;
    if (aAttrs.m_Valign === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM) {
      layout.m_StartPos = { x: layout.m_StartPos.x, y: layout.m_StartPos.y - totalHeight };
    } else if (aAttrs.m_Valign === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER) {
      // `totalHeight / 2` is C++ int division (truncates toward zero), not a round.
      layout.m_StartPos = {
        x: layout.m_StartPos.x,
        y: layout.m_StartPos.y - Math.trunc(totalHeight / 2),
      };
    }
  }

  return layout;
}
