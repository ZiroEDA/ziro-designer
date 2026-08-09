// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `LINE_STYLE`, the dash pattern of a stroke — KiCad's `common/stroke_params.h`.
 *
 * Moved out of `pcbnew/src/plot_dxf.ts` for the same reason as [Color4d]: the
 * graphics importers are shared between the board and the schematic, and a
 * schematic package cannot import from the board package. `plot_dxf.ts`
 * re-exports it.
 *
 * `DEFAULT = -1` is meaningful and is not "solid": it means the item has no
 * style of its own and inherits one.
 */

export enum LINE_STYLE {
  DEFAULT = -1,
  SOLID = 0,
  DASH,
  DOT,
  DASHDOT,
  DASHDOTDOT,
}
