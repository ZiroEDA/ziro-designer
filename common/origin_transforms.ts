// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/origin_transforms.h` / `common/origin_transforms.cpp`: the
 * `ORIGIN_TRANSFORMS` base, a no-op transform between the internal origin and
 * the user-selected display origin. `PCB_ORIGIN_TRANSFORMS` overrides it with
 * the frame's display-origin settings.
 *
 * C++'s `int` / `long long` / `double` overloads are one `number` form here.
 */

import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/**
 * The supported Display Origin Transform types
 *
 * Absolute coordinates require both translation and direction
 * inversion. Relative coordinates require only direction inversion.
 */
export enum COORD_TYPES_T {
  NOT_A_COORD = 0, //< A non-coordinate value, never transformed
  ABS_X_COORD = 1, //< An absolute X coordinate
  ABS_Y_COORD = 2, //< An absolute Y coordinate
  REL_X_COORD = 3, //< A relative X coordinate
  REL_Y_COORD = 4, //< A relative Y coordinate
}

export class ORIGIN_TRANSFORMS {
  static readonly COORD_TYPES_T = COORD_TYPES_T;

  ToDisplay(aValue: number, aCoordType: COORD_TYPES_T): number;
  ToDisplay(aValue: EDA_ANGLE, aCoordType: COORD_TYPES_T): number;
  ToDisplay(aValue: number | EDA_ANGLE, aCoordType: COORD_TYPES_T): number {
    if (typeof aValue !== 'number') return aValue.AsDegrees();

    return aValue;
  }

  FromDisplay(aValue: number, aCoordType: COORD_TYPES_T): number;
  FromDisplay(aValue: EDA_ANGLE, aCoordType: COORD_TYPES_T): EDA_ANGLE;
  FromDisplay(aValue: number | EDA_ANGLE, aCoordType: COORD_TYPES_T): number | EDA_ANGLE {
    return aValue;
  }

  ToDisplayAbs<T extends Vec2>(aValue: T): T {
    const displayValue = { ...aValue } as { x: number; y: number } & T;
    displayValue.x = this.ToDisplay(aValue.x, COORD_TYPES_T.ABS_X_COORD);
    displayValue.y = this.ToDisplay(aValue.y, COORD_TYPES_T.ABS_Y_COORD);
    return displayValue;
  }

  ToDisplayRel<T extends Vec2>(aValue: T): T {
    const displayValue = { ...aValue } as { x: number; y: number } & T;
    displayValue.x = this.ToDisplay(aValue.x, COORD_TYPES_T.REL_X_COORD);
    displayValue.y = this.ToDisplay(aValue.y, COORD_TYPES_T.REL_Y_COORD);
    return displayValue;
  }

  FromDisplayAbs<T extends Vec2>(aValue: T): T {
    const displayValue = { ...aValue } as { x: number; y: number } & T;
    displayValue.x = this.FromDisplay(aValue.x, COORD_TYPES_T.ABS_X_COORD);
    displayValue.y = this.FromDisplay(aValue.y, COORD_TYPES_T.ABS_Y_COORD);
    return displayValue;
  }

  FromDisplayRel<T extends Vec2>(aValue: T): T {
    const displayValue = { ...aValue } as { x: number; y: number } & T;
    displayValue.x = this.FromDisplay(aValue.x, COORD_TYPES_T.REL_X_COORD);
    displayValue.y = this.FromDisplay(aValue.y, COORD_TYPES_T.REL_Y_COORD);
    return displayValue;
  }

  /** The protected static `ToDisplayRel( T aInternalValue, bool aInvertAxis )`. */
  protected static toDisplayRel(aInternalValue: number, aInvertAxis: boolean): number {
    let displayValue = aInternalValue;

    // Invert the direction if needed
    if (aInvertAxis && displayValue !== 0) displayValue = -displayValue;

    return displayValue;
  }

  /** The protected static `FromDisplayRel( T aDisplayValue, bool aInvertAxis )`. */
  protected static fromDisplayRel(aDisplayValue: number, aInvertAxis: boolean): number {
    let internalValue = aDisplayValue;

    // Invert the direction if needed
    if (aInvertAxis && internalValue !== 0) internalValue = -internalValue;

    return internalValue;
  }

  /** The protected static `ToDisplayAbs( T aInternalValue, int aUserOrigin, bool aInvertAxis )`. */
  protected static toDisplayAbs(
    aInternalValue: number,
    aUserOrigin: number,
    aInvertAxis: boolean,
  ): number {
    let displayValue = aInternalValue;

    // Make the value relative to the internal origin
    displayValue -= aUserOrigin;

    // Invert the direction if needed
    if (aInvertAxis && displayValue !== 0) displayValue = -displayValue;

    return displayValue;
  }

  /** The protected static `FromDisplayAbs( T aDisplayValue, int aUserOrigin, bool aInvertAxis )`. */
  protected static fromDisplayAbs(
    aDisplayValue: number,
    aUserOrigin: number,
    aInvertAxis: boolean,
  ): number {
    let internalValue = aDisplayValue;

    // Invert the direction if needed
    if (aInvertAxis && internalValue !== 0) internalValue = -internalValue;

    // Make the value relative to the internal origin
    internalValue += aUserOrigin;

    return internalValue;
  }
}
