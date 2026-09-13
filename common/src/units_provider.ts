// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `units_provider.h`: the frame's (or dialog's) view of the user's units,
 * which items format their message-panel rows and descriptions through.
 *
 * `ValueFromString` (the dialog-field parser) arrives with the
 * `EDA_UNIT_UTILS::UI` port that the dialogs need.
 */

import type { MINOPTMAX } from '@ziroeda/core/src/minoptmax.js';
import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import {
  type EdaDataType,
  type EdaIuScale,
  type EdaUnits,
  messageTextFromAngle,
  messageTextFromMinOptMax,
  messageTextFromValue,
  stringFromValue,
} from './eda_units.js';

/** `EDA_UNIT_UTILS::IsImperialUnit`. */
export const IsImperialUnit = (aUnit: EdaUnits): boolean => aUnit === 'in' || aUnit === 'mils';

/** `EDA_UNIT_UTILS::IsMetricUnit`. */
export const IsMetricUnit = (aUnit: EdaUnits): boolean =>
  aUnit === 'mm' || aUnit === 'um' || aUnit === 'cm';

export class UNITS_PROVIDER {
  private readonly m_iuScale: EdaIuScale;
  private m_userUnits: EdaUnits;

  constructor(aIuScale: EdaIuScale, aUnits: EdaUnits) {
    this.m_iuScale = aIuScale;
    this.m_userUnits = aUnits;
  }

  GetUserUnits(): EdaUnits {
    return this.m_userUnits;
  }
  SetUserUnits(aUnits: EdaUnits): void {
    this.m_userUnits = aUnits;
  }

  /**
   * Get the pair or units in current use.
   *
   * The primary unit is the main unit of the frame, and the secondary unit is the unit
   * of the other system that was used most recently.
   */
  GetUnitPair(): [EdaUnits, EdaUnits] {
    const aPrimaryUnit = this.GetUserUnits();
    const aSecondaryUnits: EdaUnits = IsImperialUnit(aPrimaryUnit) ? 'mm' : 'mils';
    return [aPrimaryUnit, aSecondaryUnits];
  }

  GetIuScale(): EdaIuScale {
    return this.m_iuScale;
  }

  StringFromValue(aValue: number, aAddUnitLabel = false, aType: EdaDataType = 'distance'): string {
    return stringFromValue(
      this.GetIuScale(),
      this.GetUnitsFromType(aType),
      aValue,
      aAddUnitLabel,
      aType,
    );
  }

  /**
   * A lower-precision version of StringFromValue().
   *
   * Intended to be used for status text and messages (rather than dialog edit fields)
   * where precision doesn't matter as much, but readability does.
   */
  MessageTextFromValue(
    aValue: number,
    aAddUnitLabel = true,
    aType: EdaDataType = 'distance',
  ): string {
    return messageTextFromValue(
      this.GetIuScale(),
      this.GetUnitsFromType(aType),
      aValue,
      aAddUnitLabel,
      aType,
    );
  }

  MessageTextFromMinOptMax(aValue: MINOPTMAX, aType: EdaDataType = 'distance'): string {
    return messageTextFromMinOptMax(this.GetIuScale(), this.GetUnitsFromType(aType), aValue);
  }

  MessageTextFromAngle(aValue: EDA_ANGLE, aAddUnitLabel = true): string {
    return messageTextFromAngle(aValue.AsDegrees(), aAddUnitLabel);
  }

  GetUnitsFromType(aType: EdaDataType): EdaUnits {
    // TIME and LENGTH_DELAY are EDA_DATA_TYPEs the UI port does not carry yet
    return this.GetUserUnits();
  }

  static readonly NullUiString = '';
}
