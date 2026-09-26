// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/gbr_metadata.cpp`: `FormatStringFromGerber` (`:382-440`), the one
 * function of the unit GerbView reads with. The rest - the X2 attribute
 * writers - `pcbnew/plot_gerber.ts` still does inline (common/STRUCTURE.md).
 */

/** `char2Hex` (`common/gbr_metadata.cpp`): a hex digit's value, -1 if not one. */
function char2Hex(aCode: number): number {
  if (aCode >= 0x30 && aCode <= 0x39) return aCode - 0x30; // '0'..'9'
  if (aCode >= 0x41 && aCode <= 0x46) return aCode - 0x41 + 10; // 'A'..'F'
  if (aCode >= 0x61 && aCode <= 0x66) return aCode - 0x61 + 10; // 'a'..'f'
  return -1;
}

/**
 * `FormatStringFromGerber`: undo `\uXXXX` escapes (the Gerber X2 2019 form).
 * A sequence that is not four hex digits is kept as it is.
 */
export function FormatStringFromGerber(aString: string): string {
  let txt = '';
  const count = aString.length;

  for (let ii = 0; ii < count; ++ii) {
    let code = aString.charCodeAt(ii);

    if (code === 0x5c /* '\\' */ && ii < count - 5 && aString[ii + 1] === 'u') {
      let value = 0;
      let error = false;

      for (let jj = 0; jj < 4; jj++) {
        value <<= 4;
        code = aString.charCodeAt(ii + jj + 2);

        const hexa = char2Hex(code);

        if (hexa >= 0) {
          value += hexa;
        } else {
          error = true;
          break;
        }
      }

      if (!error) {
        if (value >= ' '.charCodeAt(0)) {
          // Is a valid wxChar ?
          txt += String.fromCharCode(value);
        }

        ii += 5;
      } else {
        txt += aString[ii];
        continue;
      }
    } else {
      txt += aString[ii];
    }
  }

  return txt;
}
