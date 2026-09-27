// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT::GetUniquePadNumbers` / `GetUniquePadCount` (pcbnew/footprint.cpp)
 * over the typed footprint model CvPcb reads.
 *
 * This file used to carry a `ComputeFootprintShift` over a pad-realignment
 * transform, citing `pcbnew/footprint_utils.cpp` and `common/item_realignment.cpp`.
 * Neither exists in 10.0.5: its ExchangeFootprint places the replacement at
 * the old position and orientation and matches nothing (pcb_edit_frame.cpp:2669-2675).
 */

import { padIsAperturePad } from './pad_enumerate.js';
import type { PcbFootprint } from './types.js';

/**
 * `FOOTPRINT::GetUniquePadNumbers` (pcbnew/footprint.cpp:2532-2558) — the pad
 * numbers a footprint really offers, which is what "Filter by pin count"
 * compares against a symbol's netlist pin count and what
 * `FOOTPRINT_INFO::GetUniquePadCount` reports.
 *
 * Three kinds of pad are skipped, and every one of them is a pad a naive
 * "distinct numbers" count gets wrong:
 *
 *  - a pad with **no copper layer at all**, which is how the format expresses
 *    the extra shapes that build a complex solder-paste stencil. Ours already
 *    has this test as `PAD::IsAperturePad` (`(LayerSet() & AllCuMask()).none()`),
 *    so it is reused rather than written again.
 *  - a pad with an **empty number**, upstream's "usually mechanical, not
 *    electrical".
 *  - an **NPTH** pad, when called `DO_NOT_INCLUDE_NPTH` — which is how
 *    `footprint_info_impl.cpp:53` calls it, so it is the default here. This is
 *    the mounting-hole case: a footprint with plated mounting pads would
 *    otherwise report more pads than the symbol can ever have pins.
 */
export function uniquePadNumbers(fp: PcbFootprint, includeNpth = false): Set<string> {
  const usedNumbers = new Set<string>();

  for (const pad of fp.pads) {
    // Skip pads not on copper layers (used to build complex solder paste
    // shapes for instance).
    if (padIsAperturePad(pad)) continue;
    // Skip pads with no name, because they are usually "mechanical" pads,
    // not "electrical" pads.
    if (pad.number === '') continue;
    if (!includeNpth && pad.type === 'np_thru_hole') continue;
    usedNumbers.add(pad.number);
  }

  return usedNumbers;
}

/** `FOOTPRINT::GetUniquePadCount` — the size of {@link uniquePadNumbers}. */
export function uniquePadCount(fp: PcbFootprint, includeNpth = false): number {
  return uniquePadNumbers(fp, includeNpth).size;
}
