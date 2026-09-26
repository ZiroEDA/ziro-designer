// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/tool/selection_tool.cpp` + `include/tool/selection_tool.h`.
 */

export enum SELECTION_MODE {
  INSIDE_RECTANGLE,
  TOUCHING_RECTANGLE,
  INSIDE_LASSO,
  TOUCHING_LASSO,
}
