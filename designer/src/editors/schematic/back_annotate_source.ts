// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The board side of Update Schematic from PCB: a `Board` read as the plain
 * `PcbFootprintData[]` the back-annotation engine takes. Counterpart:
 * `BACK_ANNOTATE::getPcbModulesFromString`, which reads the same facts out of
 * the netlist payload pcbnew sends over the kiway.
 *
 * This is the whole of the coupling between the two editors, and that is on
 * purpose: the engine takes a flat list so it never has to track the board
 * model, and this file is the only thing that does.
 *
 * A footprint with no `(path …)` is skipped rather than guessed at. The path is
 * how a footprint says which symbol it came from, and a footprint that never
 * had one was placed on the board by hand — inventing a match for it from the
 * reference designator is exactly what the "re-link footprints" option exists
 * to ask permission for.
 */

import type { PcbFootprintData } from '@ziroeda/eeschema';
import type { Board, PcbFootprint } from '@ziroeda/pcbnew';
import { RESERVED_FOOTPRINT_PROPERTIES } from '@ziroeda/pcbnew';

const attr = (fp: PcbFootprint, name: string): boolean => fp.attributes?.includes(name) ?? false;

/**
 * The path of the *symbol*, which is the last element of the footprint's KIID
 * path. `(path "/<sheetUuid>/<symbolUuid>")` on a sub-sheet, `"/<symbolUuid>"`
 * on the root — and the engine matches on the root-sheet form, as our
 * single-sheet connectivity does everywhere else.
 */
function symbolPathOf(fp: PcbFootprint): string | null {
  const path = fp.path;
  if (!path) return null;
  const last = path.split('/').filter(Boolean).pop();
  return last ? `/${last}` : null;
}

/** Every footprint that claims a symbol, as back-annotation data. */
export function boardFootprintData(board: Board): PcbFootprintData[] {
  const out: PcbFootprintData[] = [];
  for (const fp of board.footprints) {
    const path = symbolPathOf(fp);
    if (!path) continue;
    const fields: Record<string, string> = {};
    for (const f of fp.fields ?? []) {
      // The reserved properties are the file format's own bookkeeping — sheet
      // name, description, filters — and were never the user's fields.
      if (RESERVED_FOOTPRINT_PROPERTIES.has(f.name)) continue;
      fields[f.name] = f.value;
    }
    out.push({
      path,
      reference: fp.reference ?? '',
      // The symbol's Footprint field is the footprint's library id.
      footprint: fp.lib,
      value: fp.value ?? '',
      dnp: attr(fp, 'dnp'),
      excludeFromBom: attr(fp, 'exclude_from_bom'),
      excludeFromPosFiles: attr(fp, 'exclude_from_pos_files'),
      fields,
    });
  }
  return out;
}
