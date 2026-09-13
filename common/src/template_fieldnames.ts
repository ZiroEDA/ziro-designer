// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/template_fieldnames.h` / `common/template_fieldnames.cpp`:
 * `FIELD_T` and the canonical field names. `TEMPLATE_FIELDNAME` /
 * `TEMPLATES` (the project's user-field templates) come with the schematic
 * settings.
 */

export enum FIELD_T {
  USER = 0, ///< The field ID hasn't been set yet; field is invalid
  REFERENCE = 1, ///< Field Reference of part, i.e. "IC21"
  VALUE = 2, ///< Field Value of part, i.e. "3.3K"
  FOOTPRINT = 3, ///< Field Name Module PCB, i.e. "16DIP300"
  DATASHEET = 4, ///< name of datasheet
  DESCRIPTION = 5, ///< Field Description of part, i.e. "1/4W 1% Metal Film Resistor"
  INTERSHEET_REFS = 6, ///< Global label cross-reference page numbers
  SHEET_NAME = 7,
  SHEET_FILENAME = 8,
  SHEET_USER = 9,
}

export const MANDATORY_FIELDS: readonly FIELD_T[] = [
  FIELD_T.REFERENCE,
  FIELD_T.VALUE,
  FIELD_T.FOOTPRINT,
  FIELD_T.DATASHEET,
  FIELD_T.DESCRIPTION,
];

export const GLOBALLABEL_MANDATORY_FIELDS: readonly FIELD_T[] = [FIELD_T.INTERSHEET_REFS];

export const SHEET_MANDATORY_FIELDS: readonly FIELD_T[] = [
  FIELD_T.SHEET_NAME,
  FIELD_T.SHEET_FILENAME,
];

// A helper to call GetDefaultFieldName with or without translation.
// Translation should be used only to display field names in dialogs
export const DO_TRANSLATE = true;

// N.B. Do not change these values without transitioning the file format
const REFERENCE_CANONICAL = 'Reference';
const VALUE_CANONICAL = 'Value';
const FOOTPRINT_CANONICAL = 'Footprint';
const DATASHEET_CANONICAL = 'Datasheet';
const DESCRIPTION_CANONICAL = 'Description';
const SHEET_NAME_CANONICAL = 'Sheetname';
const SHEET_FILE_CANONICAL = 'Sheetfile';
const INTERSHEET_REFS_CANONICAL = 'Intersheetrefs';
const USER_FIELD_CANONICAL = 'Field%d';

/**
 * Return a default symbol field name for field \a aFieldNdx for all components.
 *
 * These field names are not modifiable but template field names are.
 *
 * @param aFieldNdx The field number index, > 0.
 * @param aTranslateForHI If true, return the translated field name,
 * else get the canonical name (defualt). Translation is intended only for dialogs
 */
export function GetDefaultFieldName(aFieldId: FIELD_T, aTranslateForHI: boolean): string {
  // The translations are the English names here.
  switch (aFieldId) {
    case FIELD_T.REFERENCE:
      return REFERENCE_CANONICAL; // The symbol reference, R1, C1, etc.
    case FIELD_T.VALUE:
      return VALUE_CANONICAL; // The symbol value
    case FIELD_T.FOOTPRINT:
      return FOOTPRINT_CANONICAL; // The footprint for use with Pcbnew
    case FIELD_T.DATASHEET:
      return DATASHEET_CANONICAL; // Link to a datasheet for symbol
    case FIELD_T.DESCRIPTION:
      return DESCRIPTION_CANONICAL; // The symbol description
    case FIELD_T.SHEET_NAME:
      return SHEET_NAME_CANONICAL;
    case FIELD_T.SHEET_FILENAME:
      return SHEET_FILE_CANONICAL;
    case FIELD_T.INTERSHEET_REFS:
      return INTERSHEET_REFS_CANONICAL;
    default:
      return GetUserFieldName(42, aTranslateForHI);
  }
}

export function GetUserFieldName(aFieldNdx: number, aTranslateForHI: boolean): string {
  return USER_FIELD_CANONICAL.replace('%d', String(aFieldNdx));
}

export function GetCanonicalFieldName(aFieldType: FIELD_T): string {
  return GetDefaultFieldName(aFieldType, !DO_TRANSLATE);
}

/** `wxString::CmpNoCase`. */
function cmpNoCase(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();

  return la < lb ? -1 : la > lb ? 1 : 0;
}

/**
 * Returns true if two field names are duplicates (i.e. would collide in the file format).
 */
export function FieldNamesAreDuplicates(
  aLhs: string,
  aRhs: string,
  aMandatoryFields: readonly FIELD_T[] = MANDATORY_FIELDS,
): boolean {
  if (aLhs === aRhs) return true;

  // If they don't even match case-insensitively they can't both be variants of the same
  // canonical mandatory field name.
  if (cmpNoCase(aLhs, aRhs) !== 0) return false;

  // Mandatory field names are folded case-insensitively by the s-expression parser, so any
  // case variant of a mandatory canonical name collides with the canonical mandatory field.
  for (const fieldId of aMandatoryFields) {
    if (cmpNoCase(aLhs, GetCanonicalFieldName(fieldId)) === 0) return true;
  }

  return false;
}
