// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/io/altium/altium_parser_utils.cpp`: the string conversions every
 * Altium reader (board, library, schematic) shares.
 */

import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { LIB_ID } from '../../lib_id.js';
import { ESCAPE_CONTEXT, EscapeString } from '../../string_utils.js';

export function AltiumToKiCadLibID(aLibName: string, aLibReference: string): LIB_ID {
  const libName = LIB_ID.FixIllegalChars(aLibName, true);
  const libReference = EscapeString(aLibReference, ESCAPE_CONTEXT.CTX_LIBID);

  const key = libName !== '' ? `${libName}:${libReference}` : libReference;

  const libId = new LIB_ID();
  libId.Parse(key, true);

  return libId;
}

/**
 * Altium's overbar markup, `A\B\C` over-lining the characters each backslash
 * follows, as KiCad's `~{…}`.
 */
export function AltiumPropertyToKiCadString(aString: string): string {
  let output = '';
  let tempString = '';
  let hasPrev = false;
  let prev = '';

  // wxString iterates code points
  for (const it of aString) {
    // ( *it ).GetAsChar( &ch ) && ch == '\\'
    if (it === '\\') {
      if (hasPrev) {
        tempString += prev;
        hasPrev = false;
      }

      continue; // Backslash is ignored and not added to the output
    }

    if (hasPrev) {
      // Two letters in a row with no backslash
      if (tempString !== '') {
        output += `~{${tempString}}`;
        tempString = '';
      }

      output += prev;
    }

    prev = it;
    hasPrev = true;
  }

  // Append any leftover escaped string
  if (tempString !== '') output += `~{${tempString}}`;

  if (hasPrev) output += prev;

  return output;
}

/** `wxString::Trim().Trim( false )`: the blanks `wxSafeIsspace` knows, both ends. */
function trimBoth(s: string): string {
  return s.replace(/^[ \t\n\v\f\r]+/, '').replace(/[ \t\n\v\f\r]+$/, '');
}

/** `wxString::find`: -1 (npos) when absent. */
const npos = -1;

// https://www.altium.com/documentation/altium-designer/sch-obj-textstringtext-string-ad#!special-strings
export function AltiumSchSpecialStringsToKiCadVariables(
  aString: string,
  aOverrides: ReadonlyMap<string, string>,
): string {
  if (aString === '' || aString[0] !== '=') {
    return aString;
  }

  let result = '';

  let start = 1;
  let delimiter = 0;
  let escaping_start = 0;
  // size_t arithmetic: npos is the largest value, so compare with it as +infinity
  const pos = (p: number): number => (p === npos ? Number.POSITIVE_INFINITY : p);
  do {
    delimiter = aString.indexOf('+', start);
    escaping_start = aString.indexOf("'", start);

    if (pos(escaping_start) < pos(delimiter)) {
      const text_start = escaping_start + 1;
      let escaping_end = aString.indexOf("'", text_start);

      if (escaping_end === npos) {
        escaping_end = aString.length;
      }

      result += aString.substring(text_start, escaping_end);

      start = escaping_end + 1;
    } else {
      let specialString = trimBoth(
        delimiter === npos ? aString.substring(start) : aString.substring(start, delimiter),
      );

      if (specialString.startsWith('"') && specialString.endsWith('"'))
        specialString = specialString.substring(1, 1 + specialString.length - 2);

      if (specialString !== '') {
        // Note: Altium variable references are case-insensitive.  KiCad matches
        // case-sensitive OR to all-upper-case, so make the references all-upper-case.
        specialString = specialString.toUpperCase();

        const overrideIt = aOverrides.get(specialString);

        if (overrideIt !== undefined) specialString = overrideIt;

        result += `\${${specialString}}`;
      }

      start = delimiter + 1;
    }
  } while (delimiter !== npos);

  return result;
}

// https://www.altium.com/documentation/altium-designer/text-objects-pcb
export function AltiumPcbSpecialStringsToKiCadStrings(
  aString: string,
  aOverrides: ReadonlyMap<string, string>,
): string {
  if (aString === '') return aString;

  // Convert a 'special string' to a KiCad variable, substituting any override.
  const getVariable = (aSpecialString: string): string => {
    let str = aSpecialString.toUpperCase(); // matching is implemented using upper case strings

    const it = aOverrides.get(str);
    if (it !== undefined) str = it;

    return `\${${str}}`;
  };

  // special case: string starts with dot -> whole string is special string
  if (aString[0] === '.') {
    const specialString = aString.substring(1);
    return getVariable(specialString);
  }

  // Strings can also have one or more special strings using apostrophes to
  // delineate them, e.g. "foo '.bar' '.baz' = '.qux' quux"

  // In the common case, the string is a simple string with no special strings,
  // so bail out early.
  if (!aString.includes("'.")) {
    return aString;
  }

  let stringCopy = aString;

  // Given a position of a dot, check if it is a special string variable
  // and replace it with a variable name if defined.
  const tryReplacement = (aDotPos: number): void => {
    // Check that the dot has an apostrophe before it, if not, it's just a dot
    if (aDotPos === 0 || stringCopy[aDotPos - 1] !== "'") return;

    // Scan forward for the next apostrophe
    const apostrophePos = stringCopy.indexOf("'", aDotPos + 1);

    // Didn't find it
    if (apostrophePos === npos) return;

    // Extract the special string
    const specialString = stringCopy.substring(aDotPos + 1, apostrophePos);
    const replacement = getVariable(specialString);

    stringCopy =
      stringCopy.substring(0, aDotPos - 1) + replacement + stringCopy.substring(apostrophePos + 1);
  };

  // Work backwards through the string checking any dots
  // (so we don't mess up the positions of the dots as we replace them)
  for (let p = stringCopy.length - 1; p > 0; --p) {
    if (stringCopy[p] === '.') {
      tryReplacement(p);
    }
  }

  return stringCopy;
}

export function AltiumPinNamesToKiCad(aString: string): string {
  if (aString === '') return '';

  if (aString.startsWith('\\')) {
    const rest = aString.substring(1);

    if (!rest.includes('\\')) return `~{${rest}}`;
  }

  return AltiumPropertyToKiCadString(aString);
}

/**
 * Convert an Altium pin designator string to the equivalent KiCad pin number.
 *
 * Altium represents a pin that electrically ties multiple physical pads by placing all
 * designators in a single comma-separated string (e.g. "1,2,3" or "1, 2, 3").  KiCad
 * represents the same construct with stacked-pin bracket notation (e.g. "[1,2,3]").  The
 * input string is always stripped of surrounding whitespace; if it contains no comma it
 * is returned after that trim.
 */
export function AltiumPinDesignatorToKiCad(aDesignator: string): string {
  const designator = trimBoth(aDesignator);

  if (!designator.includes(',')) return designator;

  // Rebuild as KiCad stacked notation "[a,b,c]".  If trimming collapses the list to a
  // single token, emit the bare token so well-formed single designators never get wrapped.
  const cleaned: string[] = [];

  for (const raw of designator.split(',')) {
    const token = trimBoth(raw);

    if (token !== '') cleaned.push(token);
  }

  if (cleaned.length === 0) return designator;

  if (cleaned.length === 1) return cleaned[0]!;

  return `[${cleaned.join(',')}]`;
}

export function AltiumGetEllipticalPos(
  aMajor: number,
  aMinor: number,
  aAngleRadians: number,
): VECTOR2I {
  if (aMajor === 0 || aMinor === 0) return { x: 0, y: 0 };

  const numerator = aMajor * aMinor;
  const majorTerm = aMajor * Math.sin(aAngleRadians);
  const minorTerm = aMinor * Math.cos(aAngleRadians);
  const denominator = Math.sqrt(majorTerm * majorTerm + minorTerm * minorTerm);

  const radius = numerator / denominator;

  return {
    x: KiROUND(radius * Math.cos(aAngleRadians)),
    y: KiROUND(radius * Math.sin(aAngleRadians)),
  };
}
