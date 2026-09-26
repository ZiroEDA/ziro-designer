// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/increment.cpp` (include/increment.h): stepping the number or the
 * letters in a name.
 *
 * `IncrementString` is the old, digits-only rule the schematic labels and
 * the symbol editor's pin repeat use; `STRING_INCREMENTER` is the part-aware
 * one the board editor's Increment actions and the drawing sheet's repeated
 * text use. `IndexFromAlphabetic` / `AlphabeticFromIndex` are the
 * spreadsheet-style letter numbering both it and the array tool share.
 */

const isDigit = (c: string): boolean => c >= '0' && c <= '9';

/**
 * `IncrementString`: step the last run of digits by `aIncrement`, keeping its
 * width and whatever follows it. KiCad edits the string in place and returns
 * whether it could; here the stepped string is returned, or null for "could
 * not" - which is only a result below zero. An empty name, or one with no
 * digits, is returned unchanged (true upstream).
 */
export function IncrementString(name: string, aIncrement: number): string | null {
  if (name === '') return name;

  let suffix = '';
  let digits = '';
  let ii = name.length - 1;
  let dCount = 0;

  while (ii >= 0 && !isDigit(name[ii]!)) {
    suffix = name[ii]! + suffix;
    ii--;
  }

  while (ii >= 0 && isDigit(name[ii]!)) {
    digits = name[ii]! + digits;
    ii--;
    dCount++;
  }

  if (digits === '') return name;

  const number = Number.parseInt(digits, 10) + aIncrement;

  // Don't let result go below zero
  if (number > -1) {
    // write out the number with the original count of leading zeroes (%0<n>ld)
    return name.slice(0, ii + 1) + String(number).padStart(dCount, '0') + suffix;
  }

  return null;
}

enum STRING_PART_TYPE {
  ALPHABETIC,
  INTEGER,
  SKIP,
}

// [data] increment.cpp:210-211, the two alphabets.
const alphabetFull = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const alphaNoIOSQXZ = 'ABCDEFGHJKLMNPRTUVWY';

function containsIOSQXZ(aStr: string): boolean {
  const iosqxz = 'IOSQXZ';

  for (const c of aStr) {
    if (iosqxz.includes(c)) return true;
  }

  return false;
}

export class STRING_INCREMENTER {
  private m_SkipIOSQXZ = true;
  private m_AlphabeticMaxIndex = 50;

  /**
   * If a alphabetic part is found, skip the letters I, O, S, Q, X, Z.
   * (if one is already there, increment it anyway).
   */
  SetSkipIOSQXZ(aSkip: boolean): void {
    this.m_SkipIOSQXZ = aSkip;
  }

  /**
   * Set the maximum index for alphabetic parts.
   *
   * This means that if the index is greater than this, it will be treated
   * as un-incrementable. This is to avoid incrementing things like "TX" or
   * "CAN", which would be indexes of hundreds (unlikely to be a BGA row prefix,
   * for example).
   *
   * Setting < 0 disables the check (no limit)
   */
  SetAlphabeticMaxIndex(aMaxIndex: number): void {
    this.m_AlphabeticMaxIndex = aMaxIndex;
  }

  /** Increment the n-th part from the right of the given string. */
  Increment(aStr: string, aDelta: number, aRightIndex: number): string | undefined {
    if (aStr === '') return undefined;

    let remaining = aStr;
    const parts: [string, STRING_PART_TYPE][] = [];
    let goodParts = 0;

    // Keep popping chunks off the string until we have what we need
    while (goodParts < aRightIndex + 1 && remaining !== '') {
      const integer = /\d+$/.exec(remaining);
      // ABC or abc but not Abc
      const sameCaseAlphabet = /([a-z]+|[A-Z]+)$/.exec(remaining);
      // Skippables - for now anything that isn't a letter or number
      const skip = /[^a-zA-Z0-9]+$/.exec(remaining);

      if (integer) {
        parts.push([integer[0], STRING_PART_TYPE.INTEGER]);
        remaining = remaining.slice(0, remaining.length - integer[0].length);
        goodParts++;
      } else if (sameCaseAlphabet) {
        parts.push([sameCaseAlphabet[0], STRING_PART_TYPE.ALPHABETIC]);
        remaining = remaining.slice(0, remaining.length - sameCaseAlphabet[0].length);
        goodParts++;
      } else if (skip) {
        parts.push([skip[0], STRING_PART_TYPE.SKIP]);
        remaining = remaining.slice(0, remaining.length - skip[0].length);
      } else {
        // Out of ideas
        break;
      }
    }

    // Couldn't find the part we wanted
    if (goodParts < aRightIndex + 1) return undefined;

    // Increment the part we wanted
    const last = parts[parts.length - 1]!;
    const stepped = this.incrementPart(last[0], last[1], aDelta);

    if (stepped === undefined) return undefined;

    last[0] = stepped;

    // Reassemble the string - the left-over part, then parts in reverse
    let result = remaining;

    for (let i = parts.length - 1; i >= 0; i--) result += parts[i]![0];

    return result;
  }

  /** `incrementPart`: the stepped part, or undefined where KiCad returns false. */
  private incrementPart(
    aPart: string,
    aType: STRING_PART_TYPE,
    aDelta: number,
  ): string | undefined {
    switch (aType) {
      case STRING_PART_TYPE.INTEGER: {
        const zeroPadded = aPart.startsWith('0');
        const oldLen = aPart.length;
        const number = Number.parseInt(aPart, 10) + aDelta;

        // Going below zero makes things awkward
        // and is not usually that useful.
        if (number < 0) return undefined;

        let out = String(number);

        // If the number was zero-padded, we need to re-pad it. (KiCad's
        // `wxString( "0", oldLen - len )` is a size_t subtraction; a result
        // longer than the original, "0" + 10, is padded with nothing here.)
        if (zeroPadded) out = '0'.repeat(Math.max(0, oldLen - out.length)) + out;

        return out;
      }
      case STRING_PART_TYPE.ALPHABETIC: {
        // Covert to uppercase
        const upper = aPart.toUpperCase();
        const wasUpper = aPart === upper;

        const alpha = this.m_SkipIOSQXZ && !containsIOSQXZ(aPart) ? alphaNoIOSQXZ : alphabetFull;

        let index = IndexFromAlphabetic(upper, alpha);

        // Something was not in the alphabet
        if (index === -1) return undefined;

        // It's such a big number that we don't want to increment it
        if (index > this.m_AlphabeticMaxIndex && this.m_AlphabeticMaxIndex >= 0) return undefined;

        index += aDelta;

        if (index < 0) return undefined;

        const newStr = AlphabeticFromIndex(index, alpha, true);

        return wasUpper ? newStr : newStr.toLowerCase();
      }
      case STRING_PART_TYPE.SKIP:
        break;
    }

    return undefined;
  }
}

/** `IndexFromAlphabetic`: "A" is 0, "AA" is one past the last single letter. */
export function IndexFromAlphabetic(aStr: string, aAlphabet: string): number {
  let index = 0;
  const radix = aAlphabet.length;

  for (let i = 0; i < aStr.length; i++) {
    let alphaIndex = aAlphabet.indexOf(aStr[i]!);

    if (alphaIndex === -1) return -1;

    if (i !== aStr.length - 1) alphaIndex++;

    index += alphaIndex * radix ** (aStr.length - 1 - i);
  }

  return index;
}

/**
 * `AlphabeticFromIndex`. With `aZeroBasedNonUnitCols` the letter after the
 * last is "AA" rather than "BA" - the spreadsheet convention, where A is both
 * the first symbol and an implicit leading zero.
 */
export function AlphabeticFromIndex(
  aN: number,
  aAlphabet: string,
  aZeroBasedNonUnitCols: boolean,
): string {
  let itemNum = '';
  let firstRound = true;
  const radix = aAlphabet.length;
  let n = aN;

  do {
    let modN = n % radix;

    if (aZeroBasedNonUnitCols && !firstRound) modN--; // Start the "tens/hundreds/etc column" at "Ax", not "Bx"

    itemNum = aAlphabet[modN]! + itemNum;

    n = Math.floor(n / radix);
    firstRound = false;
  } while (n);

  return itemNum;
}
