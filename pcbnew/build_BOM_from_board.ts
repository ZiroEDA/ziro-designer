// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/build_BOM_from_board.cpp`: the CSV bill of materials the board
 * editor writes from the footprints on the board — not from the schematic.
 *
 * Upstream's is `BOARD_EDITOR_CONTROL::GenBOMFileFromBoard`, one function that
 * gathers, sorts, formats and writes. The gathering and the formatting are
 * here; choosing a filename and putting bytes somewhere belongs to whoever
 * calls this, because that is the half that differs in a browser.
 *
 * ## Two footprints are one line only if the value AND the footprint agree
 *
 * Grouping is on `(value, FPID)`, so two 10k resistors in different packages
 * stay two lines — which is what a purchaser needs, since they are two parts.
 *
 * ## The order is natural, not lexical
 *
 * Both the references within a line and the lines themselves sort by
 * `StrNumCmp( .., ignoreCase = true )`, so R2 precedes R10 rather than
 * following it. A line sorts by its *first* reference, after that line's own
 * references have been sorted — so the key is the lowest reference, not the
 * one that happened to be found first.
 *
 * ## A footprint excluded from the BOM is skipped entirely
 *
 * `FP_EXCLUDE_FROM_BOM` — a fiducial or a mounting hole — contributes neither
 * a line nor a count, so the quantities are what somebody has to buy.
 */
import { strNumCmp } from '@ziroeda/common/src/string_utils.js';
import type { BOARD } from './board.js';
import { FP_EXCLUDE_FROM_BOM } from './footprint.js';

/** `BOM_ENTRY`. */
export interface BomEntry {
  refs: string[];
  value: string;
  /** `LIB_ID::GetLibItemName()` — the footprint name without its library. */
  footprintName: string;
  count: number;
}

/** The grouped, sorted lines, ahead of any formatting. */
export function BuildBomEntriesFromBoard(aBoard: BOARD): BomEntry[] {
  const list: BomEntry[] = [];

  for (const footprint of aBoard.Footprints()) {
    if (footprint.GetAttributes() & FP_EXCLUDE_FROM_BOM) continue;

    let valExist = false;

    // try to find component in existing list
    for (const curEntry of list) {
      if (
        curEntry.value === footprint.GetValue() &&
        curEntry.footprintName === footprint.GetFPID().GetLibItemName()
      ) {
        curEntry.refs.push(footprint.Reference().GetShownText(false));
        curEntry.count++;

        valExist = true;
        break;
      }
    }

    // If component does not exist yet, create new one and append it to the list.
    if (!valExist) {
      list.push({
        value: footprint.Value().GetShownText(false),
        refs: [footprint.Reference().GetShownText(false)],
        footprintName: footprint.GetFPID().GetLibItemName(),
        count: 1,
      });
    }
  }

  for (const curEntry of list) curEntry.refs.sort((lhs, rhs) => strNumCmp(lhs, rhs, true));

  list.sort((lhs, rhs) => strNumCmp(lhs.refs[0]!, rhs.refs[0]!, true));

  return list;
}

/**
 * The CSV text, header included.
 *
 * The three trailing semicolons on every row are upstream's: "Supplier and
 * ref" is a column the board knows nothing about, left empty for the user to
 * fill in their spreadsheet. The header names six columns and each row emits
 * six fields, so the shape is consistent even though the last is always blank.
 */
export function BuildBomTextFromBoard(aBoard: BOARD): string {
  const rows: string[] = [];

  // Write header:
  rows.push('"Id";"Designator";"Footprint";"Quantity";"Designation";"Supplier and ref";\n');

  let id = 1;

  for (const curEntry of BuildBomEntriesFromBoard(aBoard)) {
    rows.push(
      `${id++};"${curEntry.refs.join(', ')}";"${curEntry.footprintName}";${curEntry.count};"${curEntry.value}";;;\n`,
    );
  }

  return rows.join('');
}
