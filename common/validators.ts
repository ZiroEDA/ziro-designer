// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/validators.cpp`: KiCad's text validators. Each is a
 * `wxTextValidator` with a character filter; ours carries the same filter and
 * applies it to what a field would hold, since a DOM input has no validator of
 * its own.
 *
 * Only the ones a ported dialog uses are here so far.
 */
import { GetRefDesPrefix } from './refdes_utils.js';
import { FIELD_T } from './template_fieldnames.js';

/** `wxFILTER_EMPTY` (wx/valtext.h): an empty value is not valid. */
export const wxFILTER_EMPTY = 0x1;
/** `wxFILTER_EXCLUDE_CHAR_LIST` (wx/valtext.h): the excluded characters are not valid. */
export const wxFILTER_EXCLUDE_CHAR_LIST = 0x200;

/** `wxTextValidator( wxFILTER_EXCLUDE_CHAR_LIST )`, as far as KiCad uses it. */
export class wxTextValidator {
  private m_charExcludes = '';
  private m_style: number;

  constructor(aStyle = wxFILTER_EXCLUDE_CHAR_LIST) {
    this.m_style = aStyle;
  }

  GetStyle(): number {
    return this.m_style;
  }

  SetStyle(aStyle: number): void {
    this.m_style = aStyle;
  }

  HasFlag(aFlag: number): boolean {
    return (this.m_style & aFlag) !== 0;
  }

  SetCharExcludes(aChars: string): void {
    this.m_charExcludes = aChars;
  }

  GetCharExcludes(): string {
    return this.m_charExcludes;
  }

  /** The text with every excluded character dropped, as typing it would. */
  Filter(aText: string): string {
    return [...aText].filter((c) => !this.m_charExcludes.includes(c)).join('');
  }
}

/**
 * `FOOTPRINT_NAME_VALIDATOR` (validators.cpp:45-53): the characters that
 * would stop a file being created on any platform. Used for footprint names
 * and, by PANEL_COLOR_SETTINGS, for a new theme's name, which is also its file
 * name.
 */
export class FOOTPRINT_NAME_VALIDATOR extends wxTextValidator {
  constructor() {
    super();
    // This list of characters follows the string from footprint.cpp which, in
    // turn mimics the strings from lib_id.cpp
    this.SetCharExcludes('%$<>\t\n\r"\\/:');
  }
}

/**
 * `NETNAME_VALIDATOR` (validators.cpp:168-221): validates a whole net/signal
 * name on submit rather than filtering characters as they are typed — unlike
 * `FOOTPRINT_NAME_VALIDATOR` this carries no char-exclude list, so it does not
 * extend `wxTextValidator`'s `Filter`. `Validate()` (which upstream focuses the
 * control and pops a message box) is left to the caller; a DOM field has no
 * separate validator object to invoke it.
 */
export class NETNAME_VALIDATOR {
  protected m_allowSpaces: boolean;

  constructor(aAllowSpaces = true) {
    this.m_allowSpaces = aAllowSpaces;
  }

  /** @returns the error message if `aVal` is invalid, or '' if it is valid. */
  IsValid(aVal: string): string {
    if (aVal.includes('\r') || aVal.includes('\n'))
      return 'Signal names cannot contain CR or LF characters';

    if (!this.m_allowSpaces && (aVal.includes(' ') || aVal.includes('\t')))
      return 'Signal names cannot contain spaces';

    return '';
  }
}

/**
 * `FIELD_VALIDATOR` (validators.cpp:236): a field's text never holds a carriage return, line feed
 * or tab; a reference never a space, a sheet name never a '/'; and a reference, sheet name or sheet
 * file name is never empty.
 */
export class FIELD_VALIDATOR extends wxTextValidator {
  constructor(private readonly m_fieldId: FIELD_T) {
    super(wxFILTER_EXCLUDE_CHAR_LIST);

    // Fields cannot contain carriage returns, line feeds, or tabs.
    let excludes = '\r\n\t';

    // The reference and sheet name fields cannot contain spaces.
    if (m_fieldId === FIELD_T.REFERENCE) excludes += ' ';
    else if (m_fieldId === FIELD_T.SHEET_NAME) excludes += '/';

    let style = this.GetStyle();

    // The reference, sheetname and sheetfilename fields cannot be empty.
    if (
      m_fieldId === FIELD_T.REFERENCE ||
      m_fieldId === FIELD_T.SHEET_NAME ||
      m_fieldId === FIELD_T.SHEET_FILENAME
    ) {
      style |= wxFILTER_EMPTY;
    }

    this.SetStyle(style);
    this.SetCharExcludes(excludes);
  }
}

/**
 * `GetFieldValidationErrorMessage( aFieldId, aValue )` (validators.cpp:292): why \a aValue is not a
 * valid value for the field, or "" when it is.
 */
export function GetFieldValidationErrorMessage(aFieldId: FIELD_T, aValue: string): string {
  const validator = new FIELD_VALIDATOR(aFieldId);
  let msg = '';

  if (validator.HasFlag(wxFILTER_EMPTY) && aValue === '') {
    switch (aFieldId) {
      case FIELD_T.SHEET_NAME:
        msg = 'A sheet must have a name.';
        break;
      case FIELD_T.SHEET_FILENAME:
        msg = 'A sheet must have a file specified.';
        break;
      default:
        msg = 'The value of the field cannot be empty.';
        break;
    }
  }

  if (msg === '' && validator.HasFlag(wxFILTER_EXCLUDE_CHAR_LIST)) {
    const badCharsFound: string[] = [];

    for (const excludeChar of validator.GetCharExcludes()) {
      if (aValue.includes(excludeChar)) {
        if (excludeChar === '\r') badCharsFound.push('carriage return');
        else if (excludeChar === '\n') badCharsFound.push('line feed');
        else if (excludeChar === '\t') badCharsFound.push('tab');
        else if (excludeChar === ' ') badCharsFound.push('space');
        else badCharsFound.push(`'${excludeChar}'`);
      }
    }

    if (badCharsFound.length > 0) {
      let badChars = '';

      for (let i = 0; i < badCharsFound.length; i++) {
        if (badChars !== '') {
          if (badCharsFound.length === 2) badChars += ' or ';
          else if (i < badCharsFound.length - 2) badChars += ', or ';
          else badChars += ', ';
        }

        badChars += badCharsFound[i];
      }

      switch (aFieldId) {
        case FIELD_T.REFERENCE:
          msg = `The reference designator cannot contain ${badChars} character(s).`;
          break;
        case FIELD_T.VALUE:
          msg = `The value field cannot contain ${badChars} character(s).`;
          break;
        case FIELD_T.FOOTPRINT:
          msg = `The footprint field cannot contain ${badChars} character(s).`;
          break;
        case FIELD_T.DATASHEET:
          msg = `The datasheet field cannot contain ${badChars} character(s).`;
          break;
        case FIELD_T.SHEET_NAME:
          msg = `The sheet name cannot contain ${badChars} character(s).`;
          break;
        case FIELD_T.SHEET_FILENAME:
          msg = `The sheet filename cannot contain ${badChars} character(s).`;
          break;
        default:
          msg = `The field cannot contain ${badChars} character(s).`;
          break;
      }
    }
  }

  if (msg === '') {
    if (aFieldId === FIELD_T.REFERENCE && aValue.includes('${'))
      msg = 'The reference designator cannot contain text variable references';
    else if (aFieldId === FIELD_T.REFERENCE && GetRefDesPrefix(aValue) === '')
      msg = 'References must start with a letter.';
  }

  return msg;
}
