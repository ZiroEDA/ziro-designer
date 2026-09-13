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
