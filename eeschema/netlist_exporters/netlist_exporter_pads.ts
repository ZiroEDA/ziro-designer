// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The PADS-PCB netlist (`eeschema/netlist_exporters/netlist_exporter_pads.cpp`,
 * `NETLIST_EXPORTER_PADS::WriteNetlist` / `writeListOfNets`): a `*PART*` section
 * of `REF  FOOTPRINT` (uuid order, deduped to one line per reference —
 * {@link sheetOrderedBoardSymbols}), a blank line, then a `*SIGNAL*` per net
 * listing its pins.
 *
 * A symbol with no footprint falls back to its *value*, not to a placeholder,
 * and either way spaces become underscores. Only nets with more than one pin
 * are written — a single-pin net connects nothing on the board.
 *
 * Single sheet, like the other Export Netlist dialog formats — see
 * `netlist_exporter_xml.ts`'s header. Verified against
 * `kicad-cli sch export netlist --format pads` for every single-sheet design in
 * `qa/data/eeschema/netlist_oracle/` (`qa/unittests/eeschema/
 * netlist_exporter_pads_oracle.test.ts`); a hierarchical design there is out of
 * scope the same way (the CLI always exports the whole project, this dialog
 * only the open sheet).
 */

import type { Schematic, LibSymbol } from '../types.js';
import { netPinsByName, sheetOrderedBoardSymbols, symbolField } from './netlist_exporter_base.js';

export function netlistPads(sch: Schematic, libById: Map<string, LibSymbol>): string {
  const out: string[] = ['*PADS-PCB*', '*PART*'];

  for (const { sym, ref } of sheetOrderedBoardSymbols(sch)) {
    let footprint = symbolField(sym, 'Footprint').trim().replace(/ /g, '_');
    if (!footprint) footprint = symbolField(sym, 'Value').trim().replace(/ /g, '_');
    // "{:<16} {}": the reference is padded to 16 columns.
    out.push(`${ref.padEnd(16)} ${footprint}`);
  }

  // WriteNetlist prints a blank line after the *PART* section before
  // writeListOfNets's own "*NET*\n".
  out.push('');
  out.push('*NET*');
  for (const { name, pins } of netPinsByName(sch, libById)) {
    if (pins.length <= 1) continue;
    out.push(`*SIGNAL* ${name}`);
    // Six connections to a line, "which seems to be the standard everyone
    // follows" — the break lands *after* the seventh and every sixth beyond it,
    // since the counter starts at zero.
    let line = '';
    pins.forEach(({ ref, pin }, i) => {
      line += `${ref}.${pin}`;
      if (i !== 0 && i % 6 === 0) {
        out.push(line);
        line = '';
      } else {
        line += ' ';
      }
    });
    out.push(line);
  }

  out.push('*END*');
  return `${out.join('\n')}\n`;
}
