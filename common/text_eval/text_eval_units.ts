// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/text_eval/text_eval_units.h`: `text_eval_units::UnitRegistry`, the
 * unit suffixes an expression's numbers may carry (`@{1in + 2mm}`) and their
 * factor to millimetres. The table is KiCad's data, mirrored.
 */

import type { EdaUnits } from '../eda_units.js';

/** `text_eval_units::Unit`. */
export enum Unit {
  PS_PER_MM,
  PS_PER_CM,
  PS_PER_IN,
  THOU,
  DEG,
  MM,
  CM,
  INCH,
  MIL,
  UM,
  PS,
  FS,
  INCH_QUOTE,
  DEGREE_SYMBOL,
  INVALID,
}

/** `UnitRegistry::UnitInfo`. */
export interface UnitInfo {
  unit: Unit;
  unitString: string;
  description: string;
  conversionToMM: number;
}

// Data: KiCad's `s_unitTable`, in its parsing order (longest first).
const s_unitTable: readonly UnitInfo[] = [
  {
    unit: Unit.PS_PER_MM,
    unitString: 'ps/mm',
    description: 'Picoseconds per millimeter',
    conversionToMM: 1.0,
  },
  {
    unit: Unit.PS_PER_CM,
    unitString: 'ps/cm',
    description: 'Picoseconds per centimeter',
    conversionToMM: 1.0,
  },
  {
    unit: Unit.PS_PER_IN,
    unitString: 'ps/in',
    description: 'Picoseconds per inch',
    conversionToMM: 1.0,
  },
  {
    unit: Unit.THOU,
    unitString: 'thou',
    description: 'Thousandths of an inch',
    conversionToMM: 25.4 / 1000.0,
  },
  { unit: Unit.DEG, unitString: 'deg', description: 'Degrees', conversionToMM: 1.0 },
  { unit: Unit.MM, unitString: 'mm', description: 'Millimeters', conversionToMM: 1.0 },
  { unit: Unit.CM, unitString: 'cm', description: 'Centimeters', conversionToMM: 10.0 },
  { unit: Unit.INCH, unitString: 'in', description: 'Inches', conversionToMM: 25.4 },
  {
    unit: Unit.MIL,
    unitString: 'mil',
    description: 'Mils (thousandths of an inch)',
    conversionToMM: 25.4 / 1000.0,
  },
  { unit: Unit.UM, unitString: 'um', description: 'Micrometers', conversionToMM: 1.0 / 1000.0 },
  { unit: Unit.PS, unitString: 'ps', description: 'Picoseconds', conversionToMM: 1.0 },
  { unit: Unit.FS, unitString: 'fs', description: 'Femtoseconds', conversionToMM: 1.0 },
  {
    unit: Unit.INCH_QUOTE,
    unitString: '"',
    description: 'Inches (quote notation)',
    conversionToMM: 25.4,
  },
  {
    unit: Unit.DEGREE_SYMBOL,
    unitString: '°',
    description: 'Degrees (symbol)',
    conversionToMM: 1.0,
  },
  { unit: Unit.INVALID, unitString: '', description: 'Invalid/unknown unit', conversionToMM: 1.0 },
];

/** `text_eval_units::UnitRegistry`. */
export const UnitRegistry = {
  parseUnit(unitStr: string): Unit {
    if (unitStr === '') return Unit.INVALID;

    for (const info of s_unitTable) {
      if (info.unit !== Unit.INVALID && info.unitString === unitStr) return info.unit;
    }

    return Unit.INVALID;
  },

  getUnitString(unit: Unit): string {
    for (const info of s_unitTable) {
      if (info.unit === unit) return info.unitString;
    }

    return '';
  },

  getAllUnitStrings(): string[] {
    const units: string[] = [];

    for (const info of s_unitTable) {
      if (info.unit !== Unit.INVALID && info.unitString !== '') units.push(info.unitString);
    }

    return units;
  },

  getConversionFactor(fromUnit: Unit, toUnit: Unit): number {
    if (fromUnit === toUnit) return 1.0;

    let fromToMM = 1.0;
    let toFromMM = 1.0;

    for (const info of s_unitTable) {
      if (info.unit === fromUnit) fromToMM = info.conversionToMM;
      else if (info.unit === toUnit) toFromMM = 1.0 / info.conversionToMM;
    }

    return fromToMM * toFromMM;
  },

  fromEdaUnits(edaUnits: EdaUnits): Unit {
    switch (edaUnits) {
      case 'mm':
        return Unit.MM;
      case 'cm':
        return Unit.CM;
      case 'mils':
        return Unit.MIL;
      case 'in':
        return Unit.INCH;
      case 'degrees':
        return Unit.DEG;
      case 'fs':
        return Unit.FS;
      case 'ps':
        return Unit.PS;
      case 'ps/in':
        return Unit.PS_PER_IN;
      case 'ps/cm':
        return Unit.PS_PER_CM;
      case 'ps/mm':
        return Unit.PS_PER_MM;
      case 'um':
        return Unit.UM;
      default:
        return Unit.MM; // Default fallback
    }
  },

  convertValue(value: number, fromUnit: Unit, toUnit: Unit): number {
    return value * UnitRegistry.getConversionFactor(fromUnit, toUnit);
  },

  convertToEdaUnits(value: number, unitStr: string, targetUnits: EdaUnits): number {
    const fromUnit = UnitRegistry.parseUnit(unitStr);

    if (fromUnit === Unit.INVALID) return value; // No conversion for invalid units

    const toUnit = UnitRegistry.fromEdaUnits(targetUnits);
    return UnitRegistry.convertValue(value, fromUnit, toUnit);
  },

  isValidUnit(unitStr: string): boolean {
    return UnitRegistry.parseUnit(unitStr) !== Unit.INVALID;
  },

  getUnitInfo(unit: Unit): UnitInfo | null {
    for (const info of s_unitTable) {
      if (info.unit === unit) return info;
    }

    return null;
  },
};
