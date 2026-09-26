// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/properties/property_validators.h`: the validation errors a
 * property setter can report and the generic validators.
 *
 * `EDA_DATA_TYPE` is the string union `EdaDataType` here.
 */
import type { EdaDataType } from '../eda_units.js';
import {
  type INSPECTABLE_ITEM,
  type UNITS_PROVIDER_LIKE,
  VALIDATION_ERROR,
  type VALIDATOR_RESULT,
} from './property.js';

export class VALIDATION_ERROR_TOO_LARGE extends VALIDATION_ERROR {
  constructor(
    readonly Actual: number,
    readonly Maximum: number,
    readonly DataType: EdaDataType = 'distance',
  ) {
    super();
  }

  override Format(aUnits: UNITS_PROVIDER_LIKE): string {
    const addUnit = this.DataType !== 'unitless';
    return `Value must be less than or equal to ${aUnits.StringFromValue(this.Maximum, addUnit)}`;
  }
}

export class VALIDATION_ERROR_TOO_SMALL extends VALIDATION_ERROR {
  constructor(
    readonly Actual: number,
    readonly Minimum: number,
    readonly DataType: EdaDataType = 'distance',
  ) {
    super();
  }

  override Format(aUnits: UNITS_PROVIDER_LIKE): string {
    const addUnit = this.DataType !== 'unitless';
    return `Value must be greater than or equal to ${aUnits.StringFromValue(this.Minimum, addUnit)}`;
  }
}

/**
 * A validator for use when you just need to return an error string rather than also packaging some
 * other data (for example, a limit number)
 */
export class VALIDATION_ERROR_MSG extends VALIDATION_ERROR {
  constructor(readonly Message: string) {
    super();
  }

  override Format(_aUnits: UNITS_PROVIDER_LIKE): string {
    return this.Message;
  }
}

/**
 * A set of generic validators
 */
export namespace PROPERTY_VALIDATORS {
  /** `RangeIntValidator<Min, Max>`: the template arguments are the closure's. */
  export function RangeIntValidator(
    Min: number,
    Max: number,
  ): (aValue: unknown, aItem: INSPECTABLE_ITEM | null) => VALIDATOR_RESULT {
    return (aValue: unknown, _aItem: INSPECTABLE_ITEM | null): VALIDATOR_RESULT => {
      let val = 0;

      if (typeof aValue === 'number') {
        val = aValue;
      } else if (aValue === null || aValue === undefined) {
        return null; // no value for a std::optional is always valid
      } else {
        console.assert(false, 'Expecting int-containing value');
      }

      if (val > Max) return new VALIDATION_ERROR_TOO_LARGE(val, Max);
      else if (val < Min) return new VALIDATION_ERROR_TOO_SMALL(val, Min);

      return null;
    };
  }

  export function PositiveIntValidator(
    aValue: unknown,
    _aItem: INSPECTABLE_ITEM | null,
  ): VALIDATOR_RESULT {
    let val = 0;

    if (typeof aValue === 'number') {
      val = aValue;
    } else if (aValue === null || aValue === undefined) {
      return null; // no value for a std::optional is always valid
    } else {
      console.assert(false, 'Expecting int-containing value');
    }

    if (val < 0) return new VALIDATION_ERROR_TOO_SMALL(val, 0);

    return null;
  }

  export function PositiveRatioValidator(
    aValue: unknown,
    _aItem: INSPECTABLE_ITEM | null,
  ): VALIDATOR_RESULT {
    console.assert(typeof aValue === 'number', 'Expecting double-containing value');
    const val = aValue as number;

    if (val > 1.0) {
      return new VALIDATION_ERROR_TOO_LARGE(val, 1.0, 'unitless');
    } else if (val < 0.0) {
      return new VALIDATION_ERROR_TOO_SMALL(val, 0.0, 'unitless');
    }

    return null;
  }
}
