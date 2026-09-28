// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `include/refdes_utils.h` / `common/refdes_utils.cpp`: `UTIL::` reference-designator helpers. */

/** `UTIL::GetRefDesPrefix`: the reference without its trailing number (and '?'s). */
export function GetRefDesPrefix(aRefDes: string): string {
  // find the first non-digit, non-question-mark character from the back
  let end = aRefDes.length;

  while (end > 0) {
    const ch = aRefDes[end - 1]!;

    if (ch !== '?' && !(ch >= '0' && ch <= '9')) break;

    end--;
  }

  return aRefDes.slice(0, end);
}

/** `UTIL::GetRefDesUnannotated`: the prefix followed by '?'. */
export function GetRefDesUnannotated(aSource: string): string {
  return `${GetRefDesPrefix(aSource)}?`;
}

/** `UTIL::GetRefDesNumber`: the number after the prefix, or -1 when there is none or it does not parse whole. */
export function GetRefDesNumber(aRefDes: string): number {
  let retval = -1; // negative to indicate not found

  const firstnum = aRefDes.search(/[0-9]/);

  if (firstnum !== -1) {
    const candidateValue = aRefDes.slice(firstnum);

    // wxString::ToLong: the whole remainder must be a number
    if (!/^[+-]?[0-9]+$/.test(candidateValue)) retval = -1;
    else retval = Number.parseInt(candidateValue, 10);
  }

  return retval;
}
