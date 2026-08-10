// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `COLOR4D` — a colour as four normalised components, KiCad's `common/color4d.h`.
 *
 * It lived in `pcbnew/src/plot_dxf.ts` because the DXF plotter was the first
 * thing to need it. The graphics importers need it too, and they are shared
 * between the board and the schematic, so it belongs where both can reach it.
 * `plot_dxf.ts` re-exports it, so nothing that used it there had to change.
 */

export interface Color4d {
  r: number;
  g: number;
  b: number;
  a: number;
}

export const COLOR4D_BLACK: Color4d = { r: 0, g: 0, b: 0, a: 1 };
export const COLOR4D_WHITE: Color4d = { r: 1, g: 1, b: 1, a: 1 };
