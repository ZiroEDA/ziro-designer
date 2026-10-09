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
import { kiidPathAsString } from '@ziroeda/common/kiid.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';

/**
 * Property names a footprint may carry that are NOT user fields. Before KiCad's PCB
 * fields (file version < 20230620) these reserved keys stood in for what now have
 * their own tokens, `(sheetname …)`, `(sheetfile …)`, `(descr …)`, `(tags …)`, and
 * `Footprint` duplicated the LIB_ID until V9. `parseFOOTPRINT` consumes them rather
 * than making fields of them, so nothing should present them to the user or compare
 * them against a symbol's fields.
 */
const RESERVED_FOOTPRINT_PROPERTIES: ReadonlySet<string> = new Set([
  'Sheetname',
  'Sheet name',
  'Sheetfile',
  'Sheet file',
  'ki_description',
  'ki_keywords',
  'ki_locked',
  'ki_fp_filters',
  'Footprint',
]);

/** The symbol path's last element: `FOOTPRINT::GetPath().back()`. */
function symbolPathOf(fp: FOOTPRINT): string | null {
  const path = fp.GetPath();
  if (path.length === 0) return null;
  const last = kiidPathAsString(path).split('/').filter(Boolean).pop();
  return last ? `/${last}` : null;
}

export function boardFootprintData(board: BOARD): PcbFootprintData[] {
  const out: PcbFootprintData[] = [];
  for (const fp of board.Footprints()) {
    const path = symbolPathOf(fp);
    if (!path) continue;
    const fields: Record<string, string> = {};
    for (const f of fp.GetFields()) {
      // NOT upstream: MAIL_PCB_GET_NETLIST (cross-probing.cpp:565) sends every
      // field, and BACK_ANNOTATE skips Reference and Value on the receiving
      // side (backannotate.cpp:953). Our engine has no such skip, so they are
      // held back here, where they are reported as their own changes.
      if (!f || f.GetId() === FIELD_T.REFERENCE || f.GetId() === FIELD_T.VALUE) continue;
      // NOT upstream either: a reserved property read as a field (a pre-v8
      // Sheetname) is the file's bookkeeping, never a field the user made.
      if (RESERVED_FOOTPRINT_PROPERTIES.has(f.GetCanonicalName())) continue;
      fields[f.GetCanonicalName()] = f.GetText();
    }
    out.push({
      path,
      reference: fp.GetReference(),
      // The symbol's Footprint field is the footprint's library id.
      footprint: fp.GetFPID().Format(),
      value: fp.GetValue(),
      dnp: fp.IsDNP(),
      excludeFromBom: fp.IsExcludedFromBOM(),
      excludeFromPosFiles: fp.IsExcludedFromPosFiles(),
      fields,
    });
  }
  return out;
}
