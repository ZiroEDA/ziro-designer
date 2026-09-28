// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The enums of `pcbnew/pcb_dimension.h`, on their own so that
 * `BOARD_DESIGN_SETTINGS` can carry the dimension defaults without importing
 * the item classes.
 */

export enum DIM_UNITS_FORMAT {
  NO_SUFFIX = 0, // 1234.0
  BARE_SUFFIX = 1, // 1234.0 mm
  PAREN_SUFFIX = 2, // 1234.0 (mm)
}

export enum DIM_PRECISION {
  X = 0, // 0
  X_X = 1, // 0.0
  X_XX = 2, // 0.00
  X_XXX = 3, // 0.000
  X_XXXX = 4, // 0.0000
  X_XXXXX = 5, // 0.00000
  V_VV = 6, // 0.00 / 0 / 0.0
  V_VVV = 7, // 0.000 / 0 / 0.00
  V_VVVV = 8, // 0.0000 / 0.0 / 0.000
  V_VVVVV = 9, // 0.00000 / 0.00 / 0.0000
}

export enum DIM_TEXT_POSITION {
  OUTSIDE = 0, ///< Text appears outside the dimension line (default)
  INLINE = 1, ///< Text appears in line with the dimension line
  MANUAL = 2, ///< Text placement is manually set by the user
}

export enum DIM_UNITS_MODE {
  INCH = 0, // Do not use IN: it conflicts with a Windows header
  MILS = 1,
  MM = 2,
  AUTOMATIC = 3,
}

/**
 * Used for dimension's arrow.
 */
export enum DIM_ARROW_DIRECTION {
  INWARD = 0, ///< >-----<
  OUTWARD = 1, ///< <----->
}

export enum DIM_TEXT_BORDER {
  NONE = 0,
  RECTANGLE = 1,
  CIRCLE = 2,
  ROUNDRECT = 3,
}
