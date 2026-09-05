// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from Zint (BSD-3-Clause), copyright Robin Stuart and
// contributors. See NOTICE.md.
/**
 * The Data Matrix tables, from Zint's `backend/dmatrix.h`.
 *
 * ISO/IEC 16022 Tables C.1 and 7 — the C40/TEXT shift-and-value pairs, and the
 * 48 symbol sizes with their data capacity, matrix dimensions, data-region
 * shape and error-correction block structure. Extracted mechanically rather
 * than retyped: a wrong entry in `DM_MATRIX_DATABLOCK` misinterleaves every
 * symbol above 88 codewords, and it would not be visible by reading.
 *
 * Twenty-four of the 48 sizes are DMRE (`DM_IS_DMRE`), the rectangular
 * extension from ISO/IEC 21471. `PCB_BARCODE` never asks for one — the option
 * lives in Zint's `option_3`, which `ComputeBarcode` leaves at zero — so the
 * size search skips them, but the entries have to be present because the
 * search walks the table in order.
 */
/** `dm_c40_shift` (`dmatrix.h`), 128 entries. */
export const DM_C40_SHIFT: readonly number[] = [
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0,
  2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 2, 2, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 3, 3, 3,
  3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
];

/** `dm_c40_value` (`dmatrix.h`), 128 entries. */
export const DM_C40_VALUE: readonly number[] = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
  27, 28, 29, 30, 31, 3, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 4, 5, 6, 7, 8, 9, 10, 11,
  12, 13, 15, 16, 17, 18, 19, 20, 21, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28,
  29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 22, 23, 24, 25, 26, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
];

/** `dm_text_shift` (`dmatrix.h`), 128 entries. */
export const DM_TEXT_SHIFT: readonly number[] = [
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0,
  2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 2, 2, 3,
  3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 3, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 3, 3,
];

/** `dm_text_value` (`dmatrix.h`), 128 entries. */
export const DM_TEXT_VALUE: readonly number[] = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
  27, 28, 29, 30, 31, 3, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 4, 5, 6, 7, 8, 9, 10, 11,
  12, 13, 15, 16, 17, 18, 19, 20, 21, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
  19, 20, 21, 22, 23, 24, 25, 26, 22, 23, 24, 25, 26, 0, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
  25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 27, 28, 29, 30, 31,
];

/** `dm_matrixbytes` (`dmatrix.h`), 48 entries. */
export const DM_MATRIX_BYTES: readonly number[] = [
  3, 5, 5, 8, 10, 12, 16, 18, 18, 22, 22, 24, 30, 32, 32, 36, 38, 43, 44, 44, 49, 49, 56, 62, 62,
  63, 64, 70, 72, 80, 84, 86, 90, 108, 114, 118, 144, 174, 204, 280, 368, 456, 576, 696, 816, 1050,
  1304, 1558,
];

/** `dm_intsymbol` (`dmatrix.h`), 48 entries. */
export const DM_INTSYMBOL: readonly number[] = [
  0, 1, 3, 5, 7, 9, 12, 15, 18, 23, 31, 34, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 2, 4, 6,
  10, 13, 20, 8, 11, 14, 16, 21, 25, 17, 26, 24, 19, 22, 30, 28, 29, 33, 27, 32, 35,
];

/** `dm_isDMRE` (`dmatrix.h`), 48 entries. */
export const DM_IS_DMRE: readonly number[] = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1,
  1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

/** `dm_matrixH` (`dmatrix.h`), 48 entries. */
export const DM_MATRIX_H: readonly number[] = [
  10, 12, 8, 14, 8, 16, 12, 18, 8, 20, 12, 8, 22, 16, 8, 24, 8, 12, 26, 20, 16, 8, 20, 32, 16, 8,
  12, 26, 22, 24, 20, 36, 26, 24, 40, 26, 44, 48, 52, 64, 72, 80, 88, 96, 104, 120, 132, 144,
];

/** `dm_matrixW` (`dmatrix.h`), 48 entries. */
export const DM_MATRIX_W: readonly number[] = [
  10, 12, 18, 14, 32, 16, 26, 18, 48, 20, 36, 64, 22, 36, 80, 24, 96, 64, 26, 36, 48, 120, 44, 32,
  64, 144, 88, 40, 48, 48, 64, 36, 48, 64, 40, 64, 44, 48, 52, 64, 72, 80, 88, 96, 104, 120, 132,
  144,
];

/** `dm_matrixFH` (`dmatrix.h`), 48 entries. */
export const DM_MATRIX_FH: readonly number[] = [
  10, 12, 8, 14, 8, 16, 12, 18, 8, 20, 12, 8, 22, 16, 8, 24, 8, 12, 26, 20, 16, 8, 20, 16, 16, 8,
  12, 26, 22, 24, 20, 18, 26, 24, 20, 26, 22, 24, 26, 16, 18, 20, 22, 24, 26, 20, 22, 24,
];

/** `dm_matrixFW` (`dmatrix.h`), 48 entries. */
export const DM_MATRIX_FW: readonly number[] = [
  10, 12, 18, 14, 16, 16, 26, 18, 24, 20, 18, 16, 22, 18, 20, 24, 24, 16, 26, 18, 24, 20, 22, 16,
  16, 24, 22, 20, 24, 24, 16, 18, 24, 16, 20, 16, 22, 24, 26, 16, 18, 20, 22, 24, 26, 20, 22, 24,
];

/** `dm_matrixdatablock` (`dmatrix.h`), 48 entries. */
export const DM_MATRIX_DATABLOCK: readonly number[] = [
  3, 5, 5, 8, 10, 12, 16, 18, 18, 22, 22, 24, 30, 32, 32, 36, 38, 43, 44, 44, 49, 49, 56, 62, 62,
  63, 64, 70, 72, 80, 84, 86, 90, 108, 114, 118, 144, 174, 102, 140, 92, 114, 144, 174, 136, 175,
  163, 156,
];

/** `dm_matrixrsblock` (`dmatrix.h`), 48 entries. */
export const DM_MATRIX_RSBLOCK: readonly number[] = [
  5, 7, 7, 10, 11, 12, 14, 14, 15, 18, 18, 18, 20, 24, 22, 24, 28, 27, 28, 28, 28, 32, 34, 36, 36,
  36, 36, 38, 38, 41, 42, 42, 42, 46, 48, 50, 56, 68, 42, 56, 36, 48, 56, 68, 56, 68, 62, 62,
];
