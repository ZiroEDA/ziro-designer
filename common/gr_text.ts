// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gr_text.h` / `common/gr_text.cpp`: the pen-size rules every text item
 * derives its stroke width from, `GRTextWidth`, and `GRPrintText` - text on
 * the wxDC print path (`wx/dc.ts`), each stroke a `GRLine`.
 */

import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { CALLBACK_GAL } from './callback_gal.js';
import type { Color4d } from './gal/color4d.js';
import { FONT } from './font/font.js';
import type { METRICS } from './font/font_metrics.js';
import {
  type GR_TEXT_H_ALIGN_T,
  type GR_TEXT_V_ALIGN_T,
  TEXT_ATTRIBUTES,
} from './font/text_attributes.js';
import { GRClosedPoly, GRCSegm, GRLine } from './gr_basic.js';
import { EXPRESSION_EVALUATOR } from './text_eval/text_eval_wrapper.js';
import type { wxDC } from './wx/dc.js';
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

/**
 * Return the text width in internal units, evaluating `@{...}` expressions
 * first.
 */
export function GRTextWidth(
  aText: string,
  aFont: FONT | null,
  aSize: VECTOR2I,
  aThickness: number,
  aBold: boolean,
  aItalic: boolean,
  aFontMetrics: METRICS,
): number {
  const font = aFont ?? FONT.GetFont();
  let evaluated = aText;

  if (evaluated.includes('@{')) evaluated = new EXPRESSION_EVALUATOR().Evaluate(evaluated);

  return KiROUND(
    font.StringBoundaryLimits(evaluated, aSize, aThickness, aBold, aItalic, aFontMetrics).x,
  );
}

/**
 * Print a graphic text through wxDC.
 *
 * @param aWidth is the pen width: 0 for the default (bold or normal), and
 *               negative to draw each stroke as an outline (GRCSegm) rather
 *               than filled (GRLine).
 */
export function GRPrintText(
  aDC: wxDC,
  aPos: VECTOR2I,
  aColor: Color4d,
  aText: string,
  aOrient: EDA_ANGLE,
  aSize: VECTOR2I,
  aH_justify: GR_TEXT_H_ALIGN_T,
  aV_justify: GR_TEXT_V_ALIGN_T,
  aWidth: number,
  aItalic: boolean,
  aBold: boolean,
  aFont: FONT | null,
  aFontMetrics: METRICS,
): void {
  let fill_mode = true;
  let evaluatedText = aText;
  let width = aWidth;

  if (evaluatedText.includes('@{'))
    evaluatedText = new EXPRESSION_EVALUATOR().Evaluate(evaluatedText);

  const font = aFont ?? FONT.GetFont();

  if (width === 0) {
    // Use default values if aWidth == 0
    if (aBold) width = GetPenSizeForBold(Math.min(aSize.x, aSize.y));
    else width = GetPenSizeForNormal(Math.min(aSize.x, aSize.y));
  }

  if (width < 0) {
    width = -width;
    fill_mode = false;
  }

  const callback_gal = new CALLBACK_GAL(
    // Stroke callback
    (aPt1, aPt2) => {
      if (fill_mode) GRLine(aDC, aPt1, aPt2, width, aColor);
      else GRCSegm(aDC, aPt1, aPt2, width, aColor);
    },
    // Polygon callback
    (aPoly: SHAPE_LINE_CHAIN) => {
      GRClosedPoly(aDC, aPoly.PointCount(), aPoly.CPoints(), true, aColor);
    },
  );

  const attributes = new TEXT_ATTRIBUTES();
  attributes.m_Angle = aOrient;
  attributes.m_StrokeWidth = width;
  attributes.m_Italic = aItalic;
  attributes.m_Bold = aBold;
  attributes.m_Halign = aH_justify;
  attributes.m_Valign = aV_justify;
  attributes.m_Size = aSize;

  font.DrawAt(callback_gal, evaluatedText, aPos, attributes, aFontMetrics);
}
