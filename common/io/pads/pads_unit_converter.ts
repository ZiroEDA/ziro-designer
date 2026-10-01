// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/io/pads/pads_unit_converter.cpp` / `.h`: PADS file units (mils,
 * millimetres, inches, or the 1/38100-mil BASIC database units) to nanometres,
 * with the per-part / per-decal override stack.
 */

export enum PADS_UNIT_TYPE {
  MILS, ///< Thousandths of an inch (1 mil = 0.001 inch)
  METRIC, ///< Millimeters
  INCHES, ///< Inches
}

export class PADS_UNIT_CONVERTER {
  // Conversion constants
  static readonly MILS_TO_NM = 25400.0; // 1 mil = 25.4 um = 25400 nm
  static readonly MM_TO_NM = 1000000.0; // 1 mm = 1,000,000 nm
  static readonly INCHES_TO_NM = 25400000.0; // 1 inch = 25.4 mm = 25,400,000 nm
  static readonly BASIC_TO_NM = PADS_UNIT_CONVERTER.MILS_TO_NM / 38100.0; // 1 BASIC unit = 1/38100 mil

  private m_unitType = PADS_UNIT_TYPE.MILS;
  private m_scaleFactor = PADS_UNIT_CONVERTER.MILS_TO_NM;
  private m_basicUnitsMode = false;
  private m_basicUnitsScale = PADS_UNIT_CONVERTER.BASIC_TO_NM;
  private m_unitOverrideStack: PADS_UNIT_TYPE[] = [];

  SetBaseUnits(aUnitType: PADS_UNIT_TYPE): void {
    this.m_unitType = aUnitType;
    this.updateScaleFactor();
  }

  GetUnitType(): PADS_UNIT_TYPE {
    return this.m_unitType;
  }

  SetBasicUnitsMode(aEnabled: boolean): void {
    this.m_basicUnitsMode = aEnabled;
    this.updateScaleFactor();
  }

  IsBasicUnitsMode(): boolean {
    return this.m_basicUnitsMode;
  }

  SetBasicUnitsScale(aScale: number): void {
    this.m_basicUnitsScale = aScale;

    if (this.m_basicUnitsMode) this.updateScaleFactor();
  }

  GetBasicUnitsScale(): number {
    return this.m_basicUnitsScale;
  }

  ParseFileHeader(aHeader: string): boolean {
    // Look for BASIC indicator in header like "!PADS-POWERPCB-V9.0-BASIC!"
    if (aHeader.includes('BASIC') || aHeader.includes('basic')) {
      this.SetBasicUnitsMode(true);
      return true;
    }

    // Look for explicit unit type indicators
    if (aHeader.includes('MILS') || aHeader.includes('mils')) {
      this.SetBasicUnitsMode(false);
      this.SetBaseUnits(PADS_UNIT_TYPE.MILS);
      return true;
    }

    if (aHeader.includes('METRIC') || aHeader.includes('metric')) {
      this.SetBasicUnitsMode(false);
      this.SetBaseUnits(PADS_UNIT_TYPE.METRIC);
      return true;
    }

    if (aHeader.includes('INCHES') || aHeader.includes('inches')) {
      this.SetBasicUnitsMode(false);
      this.SetBaseUnits(PADS_UNIT_TYPE.INCHES);
      return true;
    }

    return false;
  }

  static ParseUnitCode(aUnitCode: string): PADS_UNIT_TYPE | undefined {
    if (aUnitCode === '') return undefined;

    // "M" and "D" (default) both mean MILS
    if (['M', 'm', 'D', 'd', 'MILS', 'mils', 'MIL', 'mil'].includes(aUnitCode))
      return PADS_UNIT_TYPE.MILS;

    // "MM" means METRIC (millimeters)
    if (['MM', 'mm', 'METRIC', 'metric'].includes(aUnitCode)) return PADS_UNIT_TYPE.METRIC;

    // "I" means INCHES
    if (['I', 'i', 'INCHES', 'inches', 'INCH', 'inch'].includes(aUnitCode))
      return PADS_UNIT_TYPE.INCHES;

    // "N" means no override
    return undefined;
  }

  PushUnitOverride(aUnitCode: string): boolean {
    const unitType = PADS_UNIT_CONVERTER.ParseUnitCode(aUnitCode);

    if (unitType === undefined) return false;

    this.m_unitOverrideStack.push(unitType);
    this.updateScaleFactor();
    return true;
  }

  PopUnitOverride(): void {
    if (this.m_unitOverrideStack.length > 0) {
      this.m_unitOverrideStack.pop();
      this.updateScaleFactor();
    }
  }

  HasUnitOverride(): boolean {
    return this.m_unitOverrideStack.length > 0;
  }

  GetOverrideDepth(): number {
    return this.m_unitOverrideStack.length;
  }

  /** `static_cast<int64_t>( std::round( aValue * m_scaleFactor ) )`. */
  ToNanometers(aValue: number): number {
    return cRound(aValue * this.m_scaleFactor);
  }

  ToNanometersSize(aValue: number): number {
    return cRound(aValue * this.m_scaleFactor);
  }

  private updateScaleFactor(): void {
    if (this.m_basicUnitsMode) {
      this.m_scaleFactor = this.m_basicUnitsScale;
      return;
    }

    // Use override if present, otherwise use base unit type
    const effectiveType =
      this.m_unitOverrideStack.length === 0
        ? this.m_unitType
        : this.m_unitOverrideStack[this.m_unitOverrideStack.length - 1]!;

    switch (effectiveType) {
      case PADS_UNIT_TYPE.MILS:
        this.m_scaleFactor = PADS_UNIT_CONVERTER.MILS_TO_NM;
        break;
      case PADS_UNIT_TYPE.METRIC:
        this.m_scaleFactor = PADS_UNIT_CONVERTER.MM_TO_NM;
        break;
      case PADS_UNIT_TYPE.INCHES:
        this.m_scaleFactor = PADS_UNIT_CONVERTER.INCHES_TO_NM;
        break;
    }
  }
}

/** C `std::round`: halves away from zero, then truncated to the integer type. */
export function cRound(v: number): number {
  const r = v < 0 ? -Math.round(-v) : Math.round(v);
  // Math.round rounds halves up; for a non-negative v that is away from zero
  return r + 0;
}
