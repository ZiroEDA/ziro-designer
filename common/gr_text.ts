// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gr_text.h` / `common/gr_text.cpp`: the pen-size rules every text item
 * derives its stroke width from. `GRTextWidth` and `GRPrintText` (the wxDC
 * printing path) are not here: the browser has no wxDC.
 */

import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';

/**
 * Pen width for bold text: `aTextSize / 5`. The `wxSize` form takes the
 * smaller of the two dimensions.
 */
export function GetPenSizeForBold(aTextSize: number | VECTOR2I): number {
  if (typeof aTextSize !== 'number') return GetPenSizeForBold(Math.min(aTextSize.x, aTextSize.y));

  return KiROUND(aTextSize / 5.0);
}

export function GetPenSizeForDemiBold(aTextSize: number | VECTOR2I): number {
  if (typeof aTextSize !== 'number')
    return GetPenSizeForDemiBold(Math.min(aTextSize.x, aTextSize.y));

  return KiROUND(aTextSize / 6.0);
}

export function GetPenSizeForNormal(aTextSize: number | VECTOR2I): number {
  if (typeof aTextSize !== 'number') return GetPenSizeForNormal(Math.min(aTextSize.x, aTextSize.y));

  return KiROUND(aTextSize / 8.0);
}

/**
 * Don't allow text to become cluttered up in its own fatness. Bold fonts are
 * generally around aSize/5 in width, so we limit them to aSize/4, and normal
 * text to aSize/6 (0.18 when `aStrict`).
 *
 * The `float` overload (a pen already in double precision) skips the KiROUND.
 */
export function ClampTextPenSize(
  aPenSize: number,
  aSize: number | VECTOR2I,
  aStrict = false,
): number {
  if (typeof aSize !== 'number') {
    const size = Math.min(Math.abs(aSize.x), Math.abs(aSize.y));

    return ClampTextPenSize(aPenSize, size, aStrict);
  }

  const scale = aStrict ? 0.18 : 0.25;
  const maxWidth = KiROUND(aSize * scale);

  return Math.min(aPenSize, maxWidth);
}

/** `float ClampTextPenSize( float aPenSize, int aSize, bool aStrict )`. */
export function ClampTextPenSizeF(aPenSize: number, aSize: number, aStrict = false): number {
  const scale = aStrict ? 0.18 : 0.25;
  const maxWidth = Math.fround(Math.fround(aSize) * scale);

  return Math.min(aPenSize, maxWidth);
}

/** `InferBold( TEXT_ATTRIBUTES* )`: bold when the pen is nearer the bold size than the normal. */
export function InferBold(aAttrs: {
  m_StrokeWidth: number;
  m_Size: VECTOR2I;
  m_Bold: boolean;
}): void {
  const penSize = aAttrs.m_StrokeWidth;
  const textSize = { x: aAttrs.m_Size.x, y: aAttrs.m_Size.y };

  aAttrs.m_Bold =
    Math.abs(penSize - GetPenSizeForBold(textSize)) <
    Math.abs(penSize - GetPenSizeForNormal(textSize));
}

/**
 * Return the margin for knocking out text.
 */
export function GetKnockoutTextMargin(aSize: VECTOR2I, aThickness: number): number {
  return Math.max(KiROUND(aThickness / 2.0), KiROUND(aSize.y / 9.0));
}
