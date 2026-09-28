// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `pcbnew/teardrop/teardrop_types.h`. */

/**
 * define the type of a teardrop: on a via or pad, or a track end
 */
export enum TEARDROP_TYPE {
  TD_NONE = 0, // Not a teardrop: just a standard zone
  TD_UNSPECIFIED = 1, // Not specified/unknown teardrop type
  TD_VIAPAD = 2, // a teardrop on a via or pad
  TD_TRACKEND = 3, // a teardrop on a track end
  // (when 2 tracks having different widths have a teardrop on the
  // end of the largest track)
}
