// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/properties/pg_properties.cpp` with `include/properties/pg_properties.h`:
 * the property-grid cell types - how a property's value becomes the text in
 * its cell. One implementation, shared by every frame that docks a
 * PROPERTIES_PANEL; the only thing that differs between eeschema and pcbnew is
 * the frame a property asks (its display units and `EDA_IU_SCALE`), which is
 * why that is a constructor argument and not a per-editor copy of the
 * formatter. (It had drifted once: eeschema printed a bare `2100.00` where
 * KiCad prints `1900 mils`.)
 *
 * The four `*_variant.cpp` units (`COLOR4D_VARIANT_DATA`,
 * `EDA_ANGLE_VARIANT_DATA`, `STD_OPTIONAL_INT/DOUBLE_VARIANT_DATA`) exist to
 * carry those C++ types through a `wxVariant`. A JavaScript value needs no
 * carrier, so they fold in here as what the cells read from them: an empty
 * `std::optional` is `null`, and the two `Write` methods are below.
 *
 * Not ported: `PGPropertyFactory`, which builds a `wxPGProperty` per
 * `PROPERTY_BASE` - our rows are built by each editor's panel with the cell
 * type named on the row; `PGPROPERTY_AREA` and `PGPROPERTY_TIME`, whose
 * `StringFromValue( AREA / TIME )` data types the frame formatter does not
 * have yet; `PGPROPERTY_NET`, a wxEnumProperty with a net selector editor.
 */

import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { EdaIuScale } from '../eda_units.js';
import { type Color4d, toCssString } from '../gal/color4d.js';
import { COORD_TYPES_T, ORIGIN_TRANSFORMS } from '../origin_transforms.js';
import { formatG } from '../plotters/fmt.js';
import { unescapeString } from '../string_utils.js';
import type { StatusUnits } from '../widgets/kistatusbar_format.js';
import { stringFromValue } from '../widgets/unit_binder.js';

/**
 * What a cell asks its `EDA_DRAW_FRAME* m_parentFrame`: the user units, the
 * frame's `EDA_IU_SCALE`, and its origin transforms (the identity unless the
 * frame has a user origin).
 */
export interface PG_FRAME {
  readonly units: StatusUnits;
  readonly iuScale: EdaIuScale;
  readonly originTransforms?: ORIGIN_TRANSFORMS;
}

const IDENTITY_TRANSFORMS = new ORIGIN_TRANSFORMS();

/**
 * `m_parentFrame->StringFromValue( value, true, EDA_DATA_TYPE::DISTANCE )`:
 * the editable-field precision (eeschema scale: `%.3f` mils, `%.6f` in,
 * `%.10f` mm, trailing zeros removed), with the unit label.
 */
function frameStringFromValue(aFrame: PG_FRAME, aValueIU: number): string {
  return stringFromValue(aFrame.iuScale.iuToMM(aValueIU), aFrame.units, true, aFrame.iuScale);
}

// ---------------------------------------------------------------------------
// The variant data, folded

/**
 * `COLOR4D_VARIANT_DATA::Write`: the colour's own text when it was given as
 * text (`m_text`), else `COLOR4D::ToCSSString()`.
 */
export function COLOR4D_VARIANT_DATA_Write(aColor: Color4d & { m_text?: string }): string {
  return aColor.m_text ?? toCssString(aColor);
}

/** `EDA_ANGLE_VARIANT_DATA::Write`: `"%g°"` of the angle in degrees. */
export function EDA_ANGLE_VARIANT_DATA_Write(aAngle: EDA_ANGLE): string {
  return `${formatG(aAngle.AsDegrees())}°`;
}

// ---------------------------------------------------------------------------
// PGPROPERTY_DISTANCE and its subclasses

/**
 * `PGPROPERTY_DISTANCE`: the base of `PGPROPERTY_SIZE` and `PGPROPERTY_COORD`.
 * The value is internal units, or `null` for an empty `std::optional<int>`.
 */
export class PGPROPERTY_DISTANCE {
  protected readonly m_parentFrame: PG_FRAME;
  protected readonly m_coordType: COORD_TYPES_T;

  constructor(aParentFrame: PG_FRAME, aCoordType: COORD_TYPES_T = COORD_TYPES_T.NOT_A_COORD) {
    this.m_parentFrame = aParentFrame;
    this.m_coordType = aCoordType;
  }

  CoordType(): COORD_TYPES_T {
    return this.m_coordType;
  }

  /**
   * `PGPROPERTY_DISTANCE::DistanceToString` (pg_properties.cpp:346-389).
   * Every branch ends in `StringFromValue( distanceIU, true, DISTANCE )`, so
   * the cell carries its unit; an empty optional is the empty string.
   */
  DistanceToString(aValue: number | null): string {
    if (aValue === null) return '';

    const transforms = this.m_parentFrame.originTransforms ?? IDENTITY_TRANSFORMS;
    const distanceIU = transforms.ToDisplay(aValue, this.m_coordType);

    return frameStringFromValue(this.m_parentFrame, distanceIU);
  }

  ValueToString(aValue: number | null): string {
    return this.DistanceToString(aValue);
  }
}

/** `PGPROPERTY_SIZE`: a distance that is never transformed (a wxUIntProperty upstream). */
export class PGPROPERTY_SIZE extends PGPROPERTY_DISTANCE {
  constructor(aParentFrame: PG_FRAME) {
    super(aParentFrame, COORD_TYPES_T.NOT_A_COORD);
  }
}

/** `PGPROPERTY_COORD`: a signed distance, transformed by its coordinate type. */
export class PGPROPERTY_COORD extends PGPROPERTY_DISTANCE {}

// ---------------------------------------------------------------------------
// PGPROPERTY_RATIO, PGPROPERTY_ANGLE

/** `PGPROPERTY_RATIO`: a scale-free double, `"%g"`, empty for an empty optional. */
export class PGPROPERTY_RATIO {
  ValueToString(aValue: number | null): string {
    if (aValue === null) return '';

    return formatG(aValue);
  }
}

/**
 * `PGPROPERTY_ANGLE`: degrees with the degree sign. `m_scale` is 10 for a
 * `PT_DECIDEGREE` property, which stores tenths.
 */
export class PGPROPERTY_ANGLE {
  private m_scale = 1.0;

  SetScale(aScale: number): void {
    this.m_scale = aScale;
  }

  GetScale(): number {
    return this.m_scale;
  }

  /** `ValueToString`: `"%g°"` of the value over the scale, or an EDA_ANGLE's own Write. */
  ValueToString(aValue: number | EDA_ANGLE | null): string {
    if (aValue === null) return '';

    if (typeof aValue !== 'number') return EDA_ANGLE_VARIANT_DATA_Write(aValue);

    return `${formatG(aValue / this.m_scale)}°`;
  }

  /**
   * `StringToValue`: `wxString::ToDouble` over the whole text, scaled. A text
   * that does not convert makes the variant null - here `null`.
   */
  StringToValue(aText: string): number | null {
    const text = aText.trim();

    if (text === '' || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) return null;

    return Number(text) * this.m_scale;
  }
}

// ---------------------------------------------------------------------------
// PGPROPERTY_STRING, PGPROPERTY_COLOR4D, PGPROPERTY_COLORENUM

/**
 * `PGPROPERTY_STRING`: the cell shows the string unescaped (`{slash}` as `/`).
 * The way back is `EscapeString( text, CTX_QUOTED_STR )`, which escapes only
 * the double quote; string rows here commit through their own setters.
 */
export class PGPROPERTY_STRING {
  ValueToString(aValue: string): string {
    return unescapeString(aValue);
  }
}

/**
 * `PGPROPERTY_COLOR4D`: a colour property. `m_backgroundColor` is what a
 * translucent colour composites over in the swatch (`LAYER_SCHEMATIC_BACKGROUND`
 * for eeschema's panel).
 */
export class PGPROPERTY_COLOR4D {
  private readonly m_backgroundColor: Color4d | null;

  constructor(aBackgroundColor: Color4d | null = null) {
    this.m_backgroundColor = aBackgroundColor;
  }

  GetBackgroundColor(): Color4d | null {
    return this.m_backgroundColor;
  }

  ValueToString(aValue: Color4d & { m_text?: string }): string {
    return COLOR4D_VARIANT_DATA_Write(aValue);
  }
}

/**
 * `PGPROPERTY_COLORENUM`: an enum whose cell paints a colour rectangle before
 * the label (`OnCustomPaint`), `OnMeasureImage` wide. pcbnew gives every
 * `PCB_LAYER_ID` property one, coloured by the frame's colour settings.
 */
export class PGPROPERTY_COLORENUM {
  /** `OnMeasureImage`: `wxSize( 16, -1 )`, DIP. */
  static readonly IMAGE_WIDTH = 16;

  private m_colorFunc: ((aChoice: string) => string | null) | null = null;

  /** `SetColorFunc`: the colour for a choice, or null (`wxNullColour`) for none. */
  SetColorFunc(aFunc: (aChoice: string) => string | null): void {
    this.m_colorFunc = aFunc;
  }

  /** `GetColor`, which `OnCustomPaint` paints; null paints nothing. */
  GetColor(aChoice: string): string | null {
    return this.m_colorFunc ? this.m_colorFunc(aChoice) : null;
  }
}
