// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from Zint (BSD-3-Clause), copyright Robin Stuart and
// contributors. See NOTICE.md.
/**
 * Code 39, from Zint's `backend/code.c`.
 *
 * ISO/IEC 16388:2007. Each character is nine bar/space elements plus one
 * inter-character space, every element either narrow (1) or wide (2), and the
 * symbol is bracketed by the `*` start/stop pattern. That is the whole
 * symbology — no check digit unless asked for, and `ComputeBarcode` never asks
 * (`symbol->option_2` is left at its `ZBarcode_Create` default of 0).
 */
import { expand, notSaneLookup, setHeight, type ZintSymbol } from './common.js';

/**
 * `SILVER` (`code.c:39`). Only the first 43 entries are Code 39's alphabet —
 * the `abcd` tail belongs to Code 93 — which is why the lookup below is capped
 * at 43.
 */
const SILVER = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%abcd';

/**
 * `C39Table` (`code.c:44-72`), ISO/IEC 16388:2007 Table 1 and Table A.1.
 *
 * Ten widths per row: nine elements and the trailing inter-character space.
 * Row 43 is the start character at its full ten, and the stop character is the
 * same row truncated to nine — the symbol ends on a bar, with no gap after it.
 */
const C39_TABLE: readonly string[] = [
  '1112212111',
  '2112111121',
  '1122111121',
  '2122111111',
  '1112211121',
  '2112211111',
  '1122211111',
  '1112112121',
  '2112112111',
  '1122112111',
  '2111121121',
  '1121121121',
  '2121121111',
  '1111221121',
  '2111221111',
  '1121221111',
  '1111122121',
  '2111122111',
  '1121122111',
  '1111222111',
  '2111111221',
  '1121111221',
  '2121111211',
  '1111211221',
  '2111211211',
  '1121211211',
  '1111112221',
  '2111112211',
  '1121112211',
  '1111212211',
  '2211111121',
  '1221111121',
  '2221111111',
  '1211211121',
  '2211211111',
  '1221211111',
  '1211112121',
  '2211112111',
  '1221112111',
  '1212121111',
  '1212111211',
  '1211121211',
  '1112121211',
  '1211212111', // Start character (full 10), Stop character (first 9)
];

/**
 * `code39( symbol, source, length )` (`code.c:130-238`), for
 * `symbology == BARCODE_CODE39` with the defaults `ZBarcode_Create` leaves
 * behind.
 *
 * The branches that are gone are the ones `ComputeBarcode` cannot reach:
 * LOGMARS and HIBC widen their wide bars and cap the length differently,
 * `option_2` adds the modulo-43 check digit, `COMPLIANT_HEIGHT` picks a
 * standards-derived height, and the human-readable text is Zint's own — KiCad
 * sets `show_hrt = 0` and draws the text itself from `PCB_TEXT`.
 *
 * Returns an error message, or the empty string on success. Upstream returns a
 * code and fills `symbol->errtxt`; `ComputeBarcode` only ever shows the text.
 */
export function code39(symbol: ZintSymbol, source: string): string {
  if (source.length > 86)
    // "13 (Start) + 86*13 + 12 (Stop) = 1143"
    return `Error 323: Input length ${source.length} too long (maximum 86)`;

  // `to_upper( source, length )`: the alphabet has no lower case, and Zint
  // folds rather than rejecting.
  const upper = source.toUpperCase();
  const posns: number[] = [];
  const bad = notSaneLookup(SILVER, 43 /* Up to "%" */, upper, posns);

  if (bad)
    return (
      `Error 324: Invalid character at position ${bad} in input ` +
      '(alphanumerics, space and "-.$/+%" only)'
    );

  // Start character, the data, then the stop character at nine.
  let dest = C39_TABLE[43]!;
  for (let i = 0; i < upper.length; i++) dest += C39_TABLE[posns[i]!]!;
  dest += C39_TABLE[43]!.slice(0, 9);

  expand(symbol, dest);
  setHeight(symbol, 50);

  return '';
}
