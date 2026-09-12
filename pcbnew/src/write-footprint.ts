// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `.kicad_mod` writing: `PCB_IO_KICAD_SEXPR::Format( footprint )` with
 * `CTL_FOR_LIBRARY`, over the footprint's model — what `FootprintSave` writes.
 * The tree builders that used to live here are gone with the `source` nodes.
 */
import { kfootprintFromView } from './pcb_io/kicad_sexpr/board_view.js';
import { FormatFootprintFile } from './pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import type { PcbFootprint } from './types.js';

/** Serialize a footprint to `.kicad_mod` text, the bytes `FootprintSave` writes. */
export function serializeFootprint(fp: PcbFootprint): string {
  return FormatFootprintFile(kfootprintFromView(fp));
}
