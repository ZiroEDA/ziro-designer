// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_track_types.h`: declarations of types for tracks and vias.
 */

// Flag used in locate routines (from which endpoint work)
export enum ENDPOINT_T {
  ENDPOINT_START = 0,
  ENDPOINT_END = 1,
}
export const ENDPOINT_START = ENDPOINT_T.ENDPOINT_START;
export const ENDPOINT_END = ENDPOINT_T.ENDPOINT_END;

// Note that this enum must be synchronized to GAL_LAYER_ID
export enum VIATYPE {
  THROUGH = 4 /* Always a through hole via */,
  BURIED = 3 /* this via can be on internal layers */,
  BLIND = 2 /* this via can be on internal layers */,
  MICROVIA = 1 /* this via which connect from an external layer
   * to the near neighbor internal layer */,
  NOT_DEFINED = 0 /* not yet used */,
}

export enum TENTING_MODE {
  FROM_BOARD = 0,
  TENTED = 1,
  NOT_TENTED = 2,
}

export enum COVERING_MODE {
  FROM_BOARD = 0,
  COVERED = 1,
  NOT_COVERED = 2,
}

export enum PLUGGING_MODE {
  FROM_BOARD = 0,
  PLUGGED = 1,
  NOT_PLUGGED = 2,
}

export enum CAPPING_MODE {
  FROM_BOARD = 0,
  CAPPED = 1,
  NOT_CAPPED = 2,
}

export enum FILLING_MODE {
  FROM_BOARD = 0,
  FILLED = 1,
  NOT_FILLED = 2,
}

export const UNDEFINED_DRILL_DIAMETER = -1; //< Undefined via drill diameter.
