// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/project/board_project_settings.h`: the enums the items read. The
 * settings structs themselves land with the project (#636 stage 6).
 */

export enum HIGH_CONTRAST_MODE {
  NORMAL = 0, ///< Inactive layers are shown normally (no high-contrast mode)
  DIMMED = 1, ///< Inactive layers are dimmed (old high-contrast mode)
  HIDDEN = 2, ///< Inactive layers are hidden
}

///< Determine how zones should be displayed.
export enum ZONE_DISPLAY_MODE {
  SHOW_FILLED,
  SHOW_ZONE_OUTLINE,

  // Debug modes

  SHOW_FRACTURE_BORDERS,
  SHOW_TRIANGULATION,
}

///< Determine how net color overrides should be applied.
export enum NET_COLOR_MODE {
  OFF, ///< Net (and netclass) colors are not shown
  RATSNEST, ///< Net/netclass colors are shown on ratsnest lines only
  ALL, ///< Net/netclass colors are shown on all net copper
}

///< Determine how ratsnest lines are drawn.
export enum RATSNEST_MODE {
  ALL, ///< Ratsnest lines are drawn to items on all layers (default)
  VISIBLE, ///< Ratsnest lines are drawn to items on visible layers only
}
