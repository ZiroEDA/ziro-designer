// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ARRAY_AXIS` (include/array_axis.h, common/array_axis.cpp): one axis of an
 * array's numbering - which alphabet, where it starts, how far it steps.
 */
import { AlphabeticFromIndex } from './increment.js';

enum NUMBERING_TYPE {
  NUMBERING_NUMERIC = 0, ///< Arabic numerals: 0,1,2,3,4,5,6,7,8,9,10,11...
  NUMBERING_HEX,
  NUMBERING_ALPHA_NO_IOSQXZ, ///< Alphabet, excluding IOSQXZ
  NUMBERING_ALPHA_FULL, ///< Full 26-character alphabet
}

/**
 * @return False for schemes like 0,1...9,10
 *         True for schemes like A,B..Z,AA (where the tens column starts with char 0)
 */
function schemeNonUnitColsStartAt0(type: NUMBERING_TYPE): boolean {
  return (
    type === NUMBERING_TYPE.NUMBERING_ALPHA_FULL ||
    type === NUMBERING_TYPE.NUMBERING_ALPHA_NO_IOSQXZ
  );
}

// [data] array_axis.cpp:50-53, the four alphabets.
const alphaNumeric = '0123456789';
const alphaHex = '0123456789ABCDEF';
const alphaFull = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const alphaNoIOSQXZ = 'ABCDEFGHJKLMNPRTUVWY';

export class ARRAY_AXIS {
  static readonly NUMBERING_TYPE = NUMBERING_TYPE;

  private m_type = NUMBERING_TYPE.NUMBERING_NUMERIC;
  private m_offset = 0;
  /** Skip every 'n' numbers. */
  private m_step = 1;
  /** Output lowercase letters when true (for alphabetic types). */
  private m_useLowercase = false;

  /** Check if a numbering type is a numeric type. */
  static TypeIsNumeric(type: NUMBERING_TYPE): boolean {
    return type === NUMBERING_TYPE.NUMBERING_NUMERIC || type === NUMBERING_TYPE.NUMBERING_HEX;
  }

  /** Get the alphabet for the current numbering scheme. */
  GetAlphabet(): string {
    switch (this.m_type) {
      case NUMBERING_TYPE.NUMBERING_HEX:
        return alphaHex;
      case NUMBERING_TYPE.NUMBERING_ALPHA_NO_IOSQXZ:
        return alphaNoIOSQXZ;
      case NUMBERING_TYPE.NUMBERING_ALPHA_FULL:
        return alphaFull;
      default:
        return alphaNumeric;
    }
  }

  /**
   * Get the numbering offset for a given numbering string
   *
   * @param  str is a numbering string, say "B" or "5".
   * @return the offset, if found, else empty.
   */
  private getNumberingOffset(str: string): number | undefined {
    if (str.length === 0) return undefined;

    const alphabet = this.GetAlphabet();

    let offset = 0;
    const radix = alphabet.length;

    for (let i = 0; i < str.length; i++) {
      let ch = str[i]!;

      // For alphabetic types, convert to uppercase for lookup since our alphabets
      // are defined with uppercase letters. This allows users to enter lowercase.
      if (!ARRAY_AXIS.TypeIsNumeric(this.m_type) && ch >= 'a' && ch <= 'z') ch = ch.toUpperCase();

      let chIndex = alphabet.indexOf(ch);

      if (chIndex === -1) return undefined;

      const start0 = schemeNonUnitColsStartAt0(this.m_type);

      // eg "AA" is actually index 27, not 26
      if (start0 && i < str.length - 1) chIndex++;

      offset *= radix;
      offset += chIndex;
    }

    return offset;
  }

  /** Set the axis numbering type. */
  SetAxisType(aType: NUMBERING_TYPE): void {
    this.m_type = aType;
  }

  /**
   * `SetOffset( const wxString& )`: set the axis start from a string, which
   * should decode to a valid index in the alphabet; false when it does not.
   * `SetOffset( int )`: set the start offset for the series (e.g. 0 to start
   * at 0/A, 4 to start at 4/E).
   */
  SetOffset(aOffsetName: string): boolean;
  SetOffset(aOffset: number): void;
  SetOffset(aOffset: string | number): boolean | undefined {
    if (typeof aOffset === 'number') {
      this.m_offset = aOffset;
      return undefined;
    }

    const offset = this.getNumberingOffset(aOffset);

    // The string does not decode to a valid offset
    if (offset === undefined) return false;

    // For alphabetic types, check if the user entered lowercase letters.
    // If so, we'll output lowercase letters as well.
    if (!ARRAY_AXIS.TypeIsNumeric(this.m_type) && aOffset !== '') {
      const firstChar = aOffset[0]!;
      this.m_useLowercase = firstChar >= 'a' && firstChar <= 'z';
    } else {
      this.m_useLowercase = false;
    }

    this.SetOffset(offset);
    return true;
  }

  /** Get the numbering offset for the axis. */
  GetOffset(): number {
    return this.m_offset;
  }

  /**
   * Set the skip between consecutive numbers (useful when doing a partial
   * array, e.g. only one side of a connector).
   */
  SetStep(aStep: number): void {
    this.m_step = aStep;
  }

  /**
   * Get the position number (name) for the n'th axis point
   *
   * @param  n array point index, from 0.
   * @return the point's name.
   */
  GetItemNumber(n: number): string {
    const alphabet = this.GetAlphabet();
    const nonUnitColsStartAt0 = schemeNonUnitColsStartAt0(this.m_type);

    const index = this.m_offset + this.m_step * n;

    const result = AlphabeticFromIndex(index, alphabet, nonUnitColsStartAt0);

    // If the user entered a lowercase starting value, output lowercase letters
    return this.m_useLowercase ? result.toLowerCase() : result;
  }
}
