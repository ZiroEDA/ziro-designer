// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/pcad/pcad_item_types.h`: the pointer arrays the P-CAD
 * objects keep. A `wxRealPoint` is a mutable pair of doubles.
 */

export interface wxRealPoint {
  x: number;
  y: number;
}

export type VERTICES_ARRAY = wxRealPoint[];
export type ISLANDS_ARRAY = VERTICES_ARRAY[];
