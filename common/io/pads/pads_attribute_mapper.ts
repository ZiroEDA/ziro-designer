// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/io/pads/pads_attribute_mapper.cpp` / `.h`: PADS attribute names
 * ("Ref.Des.", "Part Type", …) to KiCad field names.
 */

export class PADS_ATTRIBUTE_MAPPER {
  // Standard KiCad field names
  static readonly FIELD_REFERENCE = 'Reference';
  static readonly FIELD_VALUE = 'Value';
  static readonly FIELD_FOOTPRINT = 'Footprint';
  static readonly FIELD_DATASHEET = 'Datasheet';
  static readonly FIELD_MPN = 'MPN';
  static readonly FIELD_MANUFACTURER = 'Manufacturer';

  private m_standardMappings = new Map<string, string>();
  private m_customMappings = new Map<string, string>();

  constructor() {
    const M = PADS_ATTRIBUTE_MAPPER;
    const set = (k: string, v: string): void => {
      this.m_standardMappings.set(k, v);
    };

    // Reference designator variations
    for (const k of ['ref.des.', 'ref des', 'ref-des', 'refdes', 'reference'])
      set(k, M.FIELD_REFERENCE);

    // Value/Part type variations
    for (const k of ['part type', 'part-type', 'parttype', 'value', 'part_type'])
      set(k, M.FIELD_VALUE);

    // Footprint/Decal variations
    for (const k of ['pcb decal', 'pcb_decal', 'decal', 'footprint', 'pattern'])
      set(k, M.FIELD_FOOTPRINT);

    // Datasheet variations
    for (const k of ['datasheet', 'data sheet', 'spec', 'specification']) set(k, M.FIELD_DATASHEET);

    // MPN (Manufacturer Part Number) variations
    for (const k of [
      'part number',
      'part_number',
      'partnumber',
      'pn',
      'mpn',
      'mfr part number',
      'mfr_part_number',
    ])
      set(k, M.FIELD_MPN);

    // Manufacturer variations
    for (const k of ['manufacturer', 'mfr', 'mfg', 'vendor']) set(k, M.FIELD_MANUFACTURER);
  }

  /** `std::tolower` per byte (the "C" locale: A-Z only). */
  private normalizeAttrName(aName: string): string {
    return aName.replace(/[A-Z]/g, (c) => c.toLowerCase());
  }

  GetKiCadFieldName(aPadsAttr: string): string {
    const normalized = this.normalizeAttrName(aPadsAttr);

    // Check custom mappings first (they take precedence)
    const custom = this.m_customMappings.get(normalized);
    if (custom !== undefined) return custom;

    // Then check standard mappings
    const standard = this.m_standardMappings.get(normalized);
    if (standard !== undefined) return standard;

    // Return original name if no mapping exists
    return aPadsAttr;
  }

  IsStandardField(aPadsAttr: string): boolean {
    return (
      this.IsReferenceField(aPadsAttr) ||
      this.IsValueField(aPadsAttr) ||
      this.IsFootprintField(aPadsAttr)
    );
  }

  IsReferenceField(aPadsAttr: string): boolean {
    return this.GetKiCadFieldName(aPadsAttr) === PADS_ATTRIBUTE_MAPPER.FIELD_REFERENCE;
  }

  IsValueField(aPadsAttr: string): boolean {
    return this.GetKiCadFieldName(aPadsAttr) === PADS_ATTRIBUTE_MAPPER.FIELD_VALUE;
  }

  IsFootprintField(aPadsAttr: string): boolean {
    return this.GetKiCadFieldName(aPadsAttr) === PADS_ATTRIBUTE_MAPPER.FIELD_FOOTPRINT;
  }

  AddMapping(aPadsAttr: string, aKiCadField: string): void {
    this.m_customMappings.set(this.normalizeAttrName(aPadsAttr), aKiCadField);
  }

  /** `GetMappings()`: the custom map, in key order. */
  GetMappings(): ReadonlyMap<string, string> {
    return new Map([...this.m_customMappings].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  }
}
