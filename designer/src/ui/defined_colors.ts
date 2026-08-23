// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The colour picker's Defined Colors page — `DIALOG_COLOR_PICKER::initDefinedColors`
 * (`common/dialogs/dialog_color_picker.cpp:167-246`).
 *
 * The page is not an empty grid when the caller passes no `CUSTOM_COLORS_LIST`;
 * that is the branch that builds the DEFAULT palette, all 35 rows of
 * `colorRefs()`. Ours read the `if` the wrong way round and drew nothing, which
 * is how the whole page came to be blank.
 *
 * Reordering, upstream's comment and all:
 *
 *   "The look is better when colorRefs() order is displayed in a grid matrix
 *    of 7 row and 5 columns, first filling a row, and after the next column.
 *    But the wxFlexGrid used here must be filled by columns, then next row
 *    the best interval colorRefs() from a matrix row to the next row is 6
 *    So when have to reorder the index used to explore colorRefs()"
 *
 * A CSS grid fills row by row exactly as the wxFlexGridSizer does, so the same
 * reordering is needed here for the same reason.
 */

import { type ColorRef, colorRefs } from '@ziroeda/common/src/color4d.js';

/**
 * `table_row_count` (dialog_color_picker.cpp:179). [data] — with 35 colours it
 * makes the 7 × 5 matrix the comment describes.
 */
export const DEFINED_COLORS_ROWS = 7;

/**
 * `colorRefs()` walked the way `initDefinedColors` walks it, so that emitting
 * the result in order fills a row-major grid the way the page looks.
 *
 * The loop upstream is
 *
 *     for( jj = 0; jj < NBCOLORS; ++jj, grid_col++ )
 *         if( grid_col * table_row_count >= NBCOLORS ) { grid_col = 0; grid_row++; }
 *         ii = grid_row + ( grid_col * table_row_count );
 *
 * which is the transpose: reading DOWN the table five entries at a stride of
 * seven gives one row of the grid. Row 0 comes out Black, Blue 1, Blue 2,
 * Blue 3, Blue 4.
 */
export function definedColorGrid(): readonly ColorRef[] {
  const refs = colorRefs();
  const out: ColorRef[] = [];

  let gridCol = 0;
  let gridRow = 0;

  for (let jj = 0; jj < refs.length; ++jj, gridCol++) {
    if (gridCol * DEFINED_COLORS_ROWS >= refs.length) {
      // The current grid row is filled, and we must fill the next grid row.
      gridCol = 0;
      gridRow++;
    }

    const ii = gridRow + gridCol * DEFINED_COLORS_ROWS;
    const ref = refs[ii];

    // The stride can walk off the end when the table is not a whole multiple of
    // the row count; upstream indexes a fixed-size array and cannot, so there is
    // nothing to mirror here beyond not emitting a hole.
    if (ref) out.push(ref);
  }

  return out;
}
