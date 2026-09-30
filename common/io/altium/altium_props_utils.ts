// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/io/altium/altium_props_utils.cpp`: typed reads out of an Altium
 * `|KEY=value|KEY=value` property record, `std::map<wxString, wxString>`
 * here a `Map<string, string>`.
 */

import { ToCDoubleOk, atoi, strtodPrefix } from '../../libc/stdlib.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';

/** An Altium property record: `std::map<wxString, wxString>`. */
export type ALTIUM_PROPS = Map<string, string>;

/** `std::numeric_limits<int>::max()`. */
const INT_MAX = 2147483647;

/**
 * `std::istringstream istr( str ); istr >> doubleValue;` in the classic
 * locale: the longest number at the start (after blanks), 0 when none.
 */
function istreamDouble(aText: string): number {
  const r = strtodPrefix(aText, 0);

  // libstdc++'s num_get reads neither inf nor nan, nor hex floats.
  if (r === null || !Number.isFinite(r.value)) return 0;

  const lead = aText.trimStart().replace(/^[+-]/, '');

  if (/^0[xX]/.test(lead)) return 0;

  return r.value;
}

export const ALTIUM_PROPS_UTILS = {
  ConvertToKicadUnit(aValue: number): number {
    const int_limit = (INT_MAX - 10) / 2.54;

    const iu = KiROUND(Math.min(Math.max(aValue, -int_limit), int_limit) * 2.54);

    // Altium's internal precision is 0.1uinch.  KiCad's is 1nm.  Round to nearest 10nm to clean
    // up most rounding errors.  This allows lossless conversion of increments of 0.05mils and
    // 0.01um.
    return KiROUND(iu / 10.0) * 10;
  },

  ReadInt(aProps: ALTIUM_PROPS, aKey: string, aDefault: number): number {
    const value = aProps.get(aKey);
    return value === undefined ? aDefault : atoi(value);
  },

  ReadDouble(aProps: ALTIUM_PROPS, aKey: string, aDefault: number): number {
    const value = aProps.get(aKey);

    if (value === undefined) return aDefault;

    // Locale independent str -> double conversation
    return istreamDouble(value);
  },

  ReadBool(aProps: ALTIUM_PROPS, aKey: string, aDefault: boolean): boolean {
    const value = aProps.get(aKey);

    if (value === undefined) return aDefault;
    else return value === 'T' || value === 'TRUE';
  },

  ReadKicadUnit(aProps: ALTIUM_PROPS, aKey: string, aDefault: string): number {
    const value = ALTIUM_PROPS_UTILS.ReadString(aProps, aKey, aDefault);

    if (!value.endsWith('mil')) {
      // wxLogTrace( "ALTIUM", wxT( "Unit '%s' does not end with 'mil'." ), value );
      return 0;
    }

    let prefix = value.slice(0, -3);

    if (prefix.startsWith('+')) prefix = prefix.slice(1);

    if (!ToCDoubleOk(prefix)) {
      // wxLogTrace( "ALTIUM", wxT( "Cannot convert '%s' to double." ), prefix );
      return 0;
    }

    const mils = strtodPrefix(prefix, 0)!.value;

    return ALTIUM_PROPS_UTILS.ConvertToKicadUnit(mils * 10000);
  },

  ReadString(aProps: ALTIUM_PROPS, aKey: string, aDefault: string): string {
    const utf8Value = aProps.get(`%UTF8%${aKey}`);

    if (utf8Value !== undefined) return utf8Value;

    const value = aProps.get(aKey);

    if (value !== undefined) return value;

    return aDefault;
  },

  ReadUnicodeString(aProps: ALTIUM_PROPS, aKey: string, aDefault: string): string {
    const unicodeFlag = aProps.get('UNICODE');

    if (unicodeFlag !== undefined && unicodeFlag.includes('EXISTS')) {
      const unicodeValue = aProps.get(`UNICODE__${aKey}`);

      if (unicodeValue !== undefined) {
        // wxSplit( value, ',', '\0' ): no escape character
        const arr = unicodeValue === '' ? [] : unicodeValue.split(',');
        let out = '';

        for (const part of arr) out += String.fromCodePoint(atoi(part) >>> 0);

        return out;
      }
    }

    return ALTIUM_PROPS_UTILS.ReadString(aProps, aKey, aDefault);
  },
};
