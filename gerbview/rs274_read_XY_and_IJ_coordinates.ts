// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/rs274_read_XY_and_IJ_coordinates.cpp`: reading a coordinate
 * (`X…Y…`, `I…J…`) in the file's format, and the two number readers every
 * other reader uses, `ReadInt` and `ReadDouble`.
 *
 * `GERBER_FILE_IMAGE::ReadXYCoord` / `ReadIJCoord` are methods upstream; here
 * the bodies take the image as their first argument and the class calls them
 * (gerber_file_image.ts), because a TS class cannot be defined across files.
 *
 * "These routines read the text string point from Text. On exit, Text points
 * the beginning of the sequence unread."
 */
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { GERBER_FILE_IMAGE } from './gerber_file_image.js';
import { LAST_EXTRA_ARC_DATA_TYPE } from './gerber_file_image.js';
import { IU_PER_MM } from './gerbview.js';
import { type CHAR_PTR, NUL, ToCDouble, isspace, strncasecmp0, strtol10 } from './libc.js';

/**
 * Conversion scale from gerber file units to GerbView internal units,
 * depending on the gerber file format. "This scale list assumes gerber units
 * are imperial. For metric gerber units, the imperial to metric conversion is
 * made in read functions." [data]
 */
const scale_list: readonly number[] = [
  1000.0 * IU_PER_MM * 0.0254, // x.1 format (certainly useless)
  100.0 * IU_PER_MM * 0.0254, // x.2 format (certainly useless)
  10.0 * IU_PER_MM * 0.0254, // x.3 format
  1.0 * IU_PER_MM * 0.0254, // x.4 format
  0.1 * IU_PER_MM * 0.0254, // x.5 format
  0.01 * IU_PER_MM * 0.0254, // x.6 format
  0.001 * IU_PER_MM * 0.0254, // x.7 format  (currently the max allowed precision)
  0.0001 * IU_PER_MM * 0.0254, // provided, but not used
  0.00001 * IU_PER_MM * 0.0254, // provided, but not used
];

/** `scaletoIU`: a coordinate in floating point to GerbView's internal units. */
export function scaletoIU(aCoord: number, isMetric: boolean): number {
  if (isMetric)
    // gerber are units in mm
    return KiROUND(aCoord * IU_PER_MM);

  // gerber are units in inches
  return KiROUND(aCoord * IU_PER_MM * 25.4);
}

/** `IsNumber`: a digit, a sign or a decimal point. */
function IsNumber(x: string): boolean {
  return (x >= '0' && x <= '9' && x.length === 1) || x === '-' || x === '+' || x === '.';
}

/**
 * `std::pow<double>( 10, n )` — the scale that pads or truncates a digit
 * string to its expected length.
 */
const pow10 = (n: number): number => 10 ** n;

/** `GERBER_FILE_IMAGE::ReadXYCoord`. */
export function ReadXYCoord(
  self: GERBER_FILE_IMAGE,
  aText: CHAR_PTR | null,
  aExcellonMode = false,
): VECTOR2I {
  let pos: VECTOR2I = { x: 0, y: 0 };
  let is_float = false;

  // Set up return value for case where aText == nullptr
  if (!self.m_Relative) pos = { ...self.m_CurrentPos };

  if (aText === null) return pos;

  while (aText.c() !== NUL && (aText.c() === 'X' || aText.c() === 'Y' || aText.c() === 'A')) {
    let decimal_scale = 1.0;
    let nbdigits = 0;
    let current_coord = 0;
    const type_coord = aText.next();

    let line = '';

    while (IsNumber(aText.c())) {
      // Force decimal format if reading a floating point number
      if (aText.c() === '.') is_float = true;

      // count digits only (sign and decimal point are not counted)
      if (aText.c() >= '0' && aText.c() <= '9') nbdigits++;

      line += aText.next();
    }

    // `double val; text.ToCDouble( &val );` - val is uninitialised when nothing
    // converts; 0 stands in for the indeterminate value.
    const val = ToCDouble(line, 0);

    if (is_float) {
      current_coord = scaletoIU(val, self.m_GerbMetric);
    } else {
      const fmt_scale = type_coord === 'X' ? self.m_FmtScale.x : self.m_FmtScale.y;

      if (self.m_NoTrailingZeros) {
        // no trailing zero format, we need to add missing zeros.
        const digit_count = type_coord === 'X' ? self.m_FmtLen.x : self.m_FmtLen.y;

        // Truncate the extra digits if the len is more than expected
        // because the conversion to internal units expect exactly
        // digit_count digits.  Alternatively, add some additional digits
        // to pad out to the missing zeros
        if (nbdigits < digit_count || (aExcellonMode && nbdigits > digit_count))
          decimal_scale = pow10(digit_count - nbdigits);
      }

      let real_scale = scale_list[fmt_scale] as number;

      if (self.m_GerbMetric) real_scale = real_scale / 25.4;

      current_coord = KiROUND(val * real_scale * decimal_scale);
    }

    if (type_coord === 'X') {
      pos.x = current_coord;
    } else if (type_coord === 'Y') {
      pos.y = current_coord;
    } else if (type_coord === 'A') {
      self.m_ArcRadius = current_coord;
      self.m_LastArcDataType = LAST_EXTRA_ARC_DATA_TYPE.ARC_INFO_TYPE_RADIUS;
    }
  }

  if (self.m_Relative) pos = { x: pos.x + self.m_CurrentPos.x, y: pos.y + self.m_CurrentPos.y };

  self.m_CurrentPos = { ...pos };
  return pos;
}

/**
 * `GERBER_FILE_IMAGE::ReadIJCoord`: "These coordinates are relative, so if
 * coordinate is absent, its value defaults to 0".
 */
export function ReadIJCoord(self: GERBER_FILE_IMAGE, aText: CHAR_PTR | null): VECTOR2I {
  const pos: VECTOR2I = { x: 0, y: 0 };
  let is_float = false;

  if (aText === null) return pos;

  while (aText.c() !== NUL && (aText.c() === 'I' || aText.c() === 'J')) {
    let decimal_scale = 1.0;
    let nbdigits = 0;
    let current_coord = 0;
    const type_coord = aText.next();

    let line = '';

    while (IsNumber(aText.c())) {
      // Force decimal format if reading a floating point number
      if (aText.c() === '.') is_float = true;

      // count digits only (sign and decimal point are not counted)
      if (aText.c() >= '0' && aText.c() <= '9') nbdigits++;

      line += aText.next();
    }

    // `text.Trim( true ).Trim( false ); text.ToCDouble( &val );`
    const val = ToCDouble(line.trim(), 0);

    if (is_float) {
      current_coord = scaletoIU(val, self.m_GerbMetric);
    } else {
      const fmt_scale = type_coord === 'I' ? self.m_FmtScale.x : self.m_FmtScale.y;

      if (self.m_NoTrailingZeros) {
        // no trailing zero format, we need to add missing zeros.
        const digit_count = type_coord === 'I' ? self.m_FmtLen.x : self.m_FmtLen.y;

        if (nbdigits < digit_count) decimal_scale = pow10(digit_count - nbdigits);
      }

      let real_scale = scale_list[fmt_scale] as number;

      if (self.m_GerbMetric) real_scale = real_scale / 25.4;

      current_coord = KiROUND(val * real_scale * decimal_scale);
    }

    if (type_coord === 'I') pos.x = current_coord;
    else if (type_coord === 'J') pos.y = current_coord;
  }

  self.m_IJPos = { ...pos };
  self.m_LastArcDataType = LAST_EXTRA_ARC_DATA_TYPE.ARC_INFO_TYPE_CENTER;
  self.m_LastCoordIsIJPos = true;

  return pos;
}

/**
 * `ReadInt`: an integer from the text; a comma or a blank after it is
 * skipped when `aSkipSeparator`.
 */
export function ReadInt(text: CHAR_PTR, aSkipSeparator = true): number {
  let ret: number;

  // For strtol, a string starting by 0X or 0x is a valid number in hexadecimal or octal.
  // However, 'X'  is a separator in Gerber strings with numbers.
  // We need to detect that
  if (strncasecmp0(text, '0X', 2)) {
    text.inc();
    ret = 0;
  } else {
    // ret = (int) strtol( text, &text, 10 );
    const r = strtol10(text.buf.s, text.i);
    ret = r.value;
    text.i = r.end;
  }

  if (text.c() === ',' || isspace(text.c())) {
    if (aSkipSeparator) text.inc();
  }

  return ret;
}

/**
 * `ReadDouble`: a floating point number from the text; a comma or a blank
 * after it is skipped when `aSkipSeparator`.
 *
 * Reproduced exactly, quirks included: the number is converted from the text
 * with its LEADING blanks trimmed, but the cursor is then advanced from the
 * untrimmed position by the length found in the trimmed one; and an exponent
 * (`1e3`) converts but moves the cursor only to the `e`.
 */
export function ReadDouble(text: CHAR_PTR, aSkipSeparator = true): number {
  let ret: number;

  // For strtod, a string starting by 0X or 0x is a valid number in hexadecimal or octal.
  // However, 'X'  is a separator in Gerber strings with numbers.
  // We need to detect that
  if (strncasecmp0(text, '0X', 2)) {
    text.inc();
    ret = 0.0;
  } else {
    // wxString line( text ); line.Trim( false );
    let line = text.rest().replace(/^[ \t\n\r\f\v]+/, '');

    // line.Replace( ",", " ", false ): the FIRST ',' only, which is an
    // operand separator and not a decimal comma.
    line = line.replace(',', ' ');
    // `double ret; line.ToCDouble( &ret );` - uninitialised if nothing converts.
    ret = ToCDouble(line, 0);

    // Find the end of the float number. The float number contains only chars
    // "0123456789." but can start by a '+' or '-' char.
    if ((line[0] === '+' || line[0] === '-') && line.length > 1 && line[1] !== '$') {
      // It is the sign of a number, not an operator. Remove it to find the last digit
      line = `0${line.slice(1)}`;
    }

    let endpos = -1;

    for (let k = 0; k < line.length; k++) {
      if (!'0123456789.'.includes(line[k] as string)) {
        endpos = k;
        break;
      }
    }

    if (endpos !== -1) {
      // Advance the text pointer to the end of the number
      text.inc(endpos);
    } else {
      // If no non-number characters found, advance to the end of the string
      text.inc(line.length);
    }
  }

  if (text.c() === ',' || isspace(text.c())) {
    if (aSkipSeparator) text.inc();
  }

  return ret;
}
