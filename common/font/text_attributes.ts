// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `font/text_attributes.h` / `common/font/text_attributes.cpp`: the alignment
 * enums and `TEXT_ATTRIBUTES`, everything about a text except the text.
 */

import { ANGLE_0, type EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { type Color4d, COLOR4D_UNSPECIFIED } from '../color4d.js';
import type { FONT } from './font.js';

// Graphic Text alignments:
//
// NB: values -1,0,1 are used in computations, do not change them
//

/// This is API surface mapped to common.types.HorizontalAlignment
export enum GR_TEXT_H_ALIGN_T {
  GR_TEXT_H_ALIGN_LEFT = -1,
  GR_TEXT_H_ALIGN_CENTER = 0,
  GR_TEXT_H_ALIGN_RIGHT = 1,
  GR_TEXT_H_ALIGN_INDETERMINATE = 2,
}

/// This is API surface mapped to common.types.VertialAlignment
export enum GR_TEXT_V_ALIGN_T {
  GR_TEXT_V_ALIGN_TOP = -1,
  GR_TEXT_V_ALIGN_CENTER = 0,
  GR_TEXT_V_ALIGN_BOTTOM = 1,
  GR_TEXT_V_ALIGN_INDETERMINATE = 2,
}

export const {
  GR_TEXT_H_ALIGN_LEFT,
  GR_TEXT_H_ALIGN_CENTER,
  GR_TEXT_H_ALIGN_RIGHT,
  GR_TEXT_H_ALIGN_INDETERMINATE,
} = GR_TEXT_H_ALIGN_T;
export const {
  GR_TEXT_V_ALIGN_TOP,
  GR_TEXT_V_ALIGN_CENTER,
  GR_TEXT_V_ALIGN_BOTTOM,
  GR_TEXT_V_ALIGN_INDETERMINATE,
} = GR_TEXT_V_ALIGN_T;

/**
 * Get the reverse alignment: left-right are swapped, others are unchanged.
 */
export function GetFlippedHAlignment(aAlign: GR_TEXT_H_ALIGN_T): GR_TEXT_H_ALIGN_T {
  // Could use the -1/1 promise of the enum too.
  switch (aAlign) {
    case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT:
      return GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT;
    case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT:
      return GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT;
    case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER:
    case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_INDETERMINATE:
      break;
  }
  return aAlign;
}

/**
 * Get the reverse alignment: top-bottom are swapped, others are unchanged.
 */
export function GetFlippedVAlignment(aAlign: GR_TEXT_V_ALIGN_T): GR_TEXT_V_ALIGN_T {
  switch (aAlign) {
    case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM:
      return GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP;
    case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP:
      return GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM;
    case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER:
    case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_INDETERMINATE:
      break;
  }
  return aAlign;
}

/**
 * Convert an integral value to horizontal alignment.
 *
 *  * x < 0: Left align
 *  * x == 0: Center
 *  * x > 0: Right align
 */
export function ToHAlignment(x: number): GR_TEXT_H_ALIGN_T {
  if (x < 0) return GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT;
  if (x > 0) return GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT;
  return GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER;
}

/** `KIGFX::COLOR4D::Compare`: r, g, b then a. */
function compareColor(a: Color4d, b: Color4d): number {
  if (a.r !== b.r) return a.r < b.r ? -1 : 1;
  if (a.g !== b.g) return a.g < b.g ? -1 : 1;
  if (a.b !== b.b) return a.b < b.b ? -1 : 1;
  if (a.a !== b.a) return a.a < b.a ? -1 : 1;
  return 0;
}

/** `wxString::Cmp`: a code-point ordering. */
function cmpString(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export class TEXT_ATTRIBUTES {
  m_Font: FONT | null;
  m_Halign: GR_TEXT_H_ALIGN_T;
  m_Valign: GR_TEXT_V_ALIGN_T;
  m_Angle: EDA_ANGLE;
  m_LineSpacing: number;
  m_StrokeWidth: number;
  m_Italic: boolean;
  m_Bold: boolean;
  m_Underlined: boolean;
  m_Hover: boolean;
  m_Color: Color4d;
  m_Mirrored: boolean;
  m_Multiline: boolean;
  m_Size: VECTOR2I;

  // If true, keep rotation angle between -90...90 degrees for readability
  m_KeepUpright: boolean;

  m_StoredStrokeWidth: number;

  constructor(aFont: FONT | null = null) {
    this.m_Font = aFont;
    this.m_Halign = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER;
    this.m_Valign = GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER;
    this.m_Angle = ANGLE_0;
    this.m_LineSpacing = 1.0;
    this.m_StrokeWidth = 0;
    this.m_Italic = false;
    this.m_Bold = false;
    this.m_Underlined = false;
    this.m_Hover = false;
    this.m_Color = { ...COLOR4D_UNSPECIFIED };
    this.m_Mirrored = false;
    this.m_Multiline = true;
    this.m_Size = { x: 0, y: 0 };
    this.m_KeepUpright = false;
    this.m_StoredStrokeWidth = 0;
  }

  /** The value copy. */
  clone(): TEXT_ATTRIBUTES {
    const c = new TEXT_ATTRIBUTES(this.m_Font);
    c.assign(this);
    return c;
  }

  /** `operator=`. */
  assign(o: TEXT_ATTRIBUTES): this {
    this.m_Font = o.m_Font;
    this.m_Halign = o.m_Halign;
    this.m_Valign = o.m_Valign;
    this.m_Angle = o.m_Angle;
    this.m_LineSpacing = o.m_LineSpacing;
    this.m_StrokeWidth = o.m_StrokeWidth;
    this.m_Italic = o.m_Italic;
    this.m_Bold = o.m_Bold;
    this.m_Underlined = o.m_Underlined;
    this.m_Hover = o.m_Hover;
    this.m_Color = { ...o.m_Color };
    this.m_Mirrored = o.m_Mirrored;
    this.m_Multiline = o.m_Multiline;
    this.m_Size = { x: o.m_Size.x, y: o.m_Size.y };
    this.m_KeepUpright = o.m_KeepUpright;
    this.m_StoredStrokeWidth = o.m_StoredStrokeWidth;
    return this;
  }

  Compare(aRhs: TEXT_ATTRIBUTES): number {
    let fontName = '';

    if (this.m_Font) fontName = this.m_Font.GetName();

    let rhsFontName = '';

    if (aRhs.m_Font) rhsFontName = aRhs.m_Font.GetName();

    let retv = cmpString(fontName, rhsFontName);

    if (retv) return retv;

    if (this.m_Size.x !== aRhs.m_Size.x) return this.m_Size.x - aRhs.m_Size.x;

    if (this.m_Size.y !== aRhs.m_Size.y) return this.m_Size.y - aRhs.m_Size.y;

    if (this.m_StrokeWidth !== aRhs.m_StrokeWidth) return this.m_StrokeWidth - aRhs.m_StrokeWidth;

    if (this.m_Angle.AsDegrees() !== aRhs.m_Angle.AsDegrees())
      return this.m_Angle.AsDegrees() < aRhs.m_Angle.AsDegrees() ? -1 : 1;

    if (this.m_LineSpacing !== aRhs.m_LineSpacing)
      return this.m_LineSpacing < aRhs.m_LineSpacing ? -1 : 1;

    if (this.m_Halign !== aRhs.m_Halign) return this.m_Halign - aRhs.m_Halign;

    if (this.m_Valign !== aRhs.m_Valign) return this.m_Valign - aRhs.m_Valign;

    if (this.m_Italic !== aRhs.m_Italic) return Number(this.m_Italic) - Number(aRhs.m_Italic);

    if (this.m_Bold !== aRhs.m_Bold) return Number(this.m_Bold) - Number(aRhs.m_Bold);

    if (this.m_Underlined !== aRhs.m_Underlined)
      return Number(this.m_Underlined) - Number(aRhs.m_Underlined);

    retv = compareColor(this.m_Color, aRhs.m_Color);

    if (retv) return retv;

    if (this.m_Mirrored !== aRhs.m_Mirrored)
      return Number(this.m_Mirrored) - Number(aRhs.m_Mirrored);

    if (this.m_Multiline !== aRhs.m_Multiline)
      return Number(this.m_Multiline) - Number(aRhs.m_Multiline);

    return Number(this.m_KeepUpright) - Number(aRhs.m_KeepUpright);
  }

  equals(aRhs: TEXT_ATTRIBUTES): boolean {
    return this.Compare(aRhs) === 0;
  }
  gt(aRhs: TEXT_ATTRIBUTES): boolean {
    return this.Compare(aRhs) > 0;
  }
  lt(aRhs: TEXT_ATTRIBUTES): boolean {
    return this.Compare(aRhs) < 0;
  }
}
