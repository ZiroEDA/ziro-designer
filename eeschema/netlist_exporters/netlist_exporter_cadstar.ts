// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The CadStar netlist (`eeschema/netlist_exporters/netlist_exporter_cadstar.cpp`,
 * `NETLIST_EXPORTER_CADSTAR::WriteNetlist`). Every directive begins with `.`: a
 * `.HEA` header, one `.ADD_COM` per board-bound symbol (uuid order, deduped to
 * one line per reference — {@link sheetOrderedBoardSymbols}), then the nets.
 *
 * A net's first pin is held back and printed on the `.ADD_TER` line *with the
 * net name* once a second pin turns up — so a one-pin net emits nothing at all,
 * which is how upstream drops them without testing for it. The third pin
 * onwards are bare indented lines under the `.TER`.
 *
 * Single sheet, like the other Export Netlist dialog formats — see
 * `netlist_exporter_xml.ts`'s header. Verified against
 * `kicad-cli sch export netlist --format cadstar` for every single-sheet design
 * in `qa/data/eeschema/netlist_oracle/` (`qa/unittests/eeschema/
 * netlist_exporter_cadstar_oracle.test.ts`); a hierarchical design there is out
 * of scope the same way (the CLI always exports the whole project, this dialog
 * only the open sheet).
 */

import type { Schematic, LibSymbol } from '../types.js';
import { GENERATOR_APPLICATION } from '@ziroeda/common/generator.js';
import {
  netPinsByName,
  sheetOrderedBoardSymbols,
  symbolField,
  type NetlistMeta,
} from './netlist_exporter_base.js';

const NETLIST_HEAD = GENERATOR_APPLICATION;

export function netlistCadstar(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  meta: NetlistMeta,
): string {
  const S = '.';
  const out: string[] = [];
  out.push(`${S}HEA`);
  out.push(`${S}TIM ${meta.date ?? new Date().toISOString()}`);
  out.push(`${S}APP "${NETLIST_HEAD}"`);
  out.push('.TYP FULL');
  out.push('');

  for (const { sym, ref } of sheetOrderedBoardSymbols(sch)) {
    const footprint = symbolField(sym, 'Footprint') || '$noname';
    const value = symbolField(sym, 'Value').replace(/ /g, '_');
    out.push(`${S}ADD_COM     ${ref}     "${value}"     "${footprint}"`);
  }
  out.push('');

  for (const { name, pins } of netPinsByName(sch, libById)) {
    let held = '';
    let count = 0;
    for (const { ref, pin } of pins) {
      if (count === 0) {
        held = `\n${S}ADD_TER   ${ref}   ${pin}     "${name}"`;
        count++;
      } else if (count === 1) {
        out.push(held);
        out.push(`${S}TER       ${ref}   ${pin}`);
        count++;
      } else {
        out.push(`            ${ref}   ${pin}`);
      }
    }
  }

  out.push('');
  out.push(`${S}END`);
  return `${out.join('\n')}\n`;
}
