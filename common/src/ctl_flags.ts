// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ctl_flags.h`: the control bits the s-expression formatters take.
 */

export const CTL_OMIT_EXTRA = 1 << 0;
export const CTL_OMIT_NETS = 1 << 1;
export const CTL_OMIT_PAD_NETS = 1 << 1; ///< Omit pads net names (useless in library).
export const CTL_OMIT_UUIDS = 1 << 2; ///< Omit component unique ids (useless in library)
export const CTL_OMIT_FP_UUID = 1 << 3; ///< Don't prefix the footprint UUID to the sheet path of the footprint.
export const CTL_OMIT_PATH = 1 << 4; ///< Omit component sheet time stamp (useless in library)
export const CTL_OMIT_AT = 1 << 5; ///< Omit position and rotation. (always saved with position 0,0 and rotation = 0 in library).
export const CTL_OMIT_LIBNAME = 1 << 7; ///< Omit lib alias when saving (used for board/not library).
export const CTL_OMIT_FOOTPRINT_VERSION = 1 << 8; ///< Omit the version string from the (footprint) sexpr group
export const CTL_OMIT_FILTERS = 1 << 9; ///< Omit the ki_fp_filters attribute in .kicad_xxx files.
export const CTL_OMIT_INITIAL_COMMENTS = 1 << 10; ///< Omit #FOOTPRINT initial comments.
export const CTL_OMIT_COLOR = 1 << 11; ///< Omit the color attribute in .kicad_xxx files.
export const CTL_OMIT_HYPERLINK = 1 << 12; ///< Omit the hyperlink attribute in .kicad_xxx files.
