// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The OrcadPCB2 netlist (`eeschema/netlist_exporters/netlist_exporter_orcadpcb2.cpp`,
 * `NETLIST_EXPORTER_ORCADPCB2::WriteNetlist`): a footprints section listing
 * each symbol's uuid, footprint, ref and value, then its per-pin nets.
 *
 * Single sheet, like the KiCad-XML exporter beside it — see that file's header.
 */

import type { Schematic, LibSymbol } from '../types.js';
import { computeNetlist, enumeratePins } from '../connectivity/nets.js';
import { refId } from '../tools/hittest.js';
import { GENERATOR_APPLICATION } from '@ziroeda/common/generator.js';
import { boardSymbols, symbolField, type NetlistMeta } from './netlist_exporter_base.js';

const NETLIST_HEAD = GENERATOR_APPLICATION;

export function netlistOrcadPcb2(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  meta: NetlistMeta,
): string {
  const netlist = computeNetlist(sch, libById);
  const pins = enumeratePins(sch, libById);
  // pin id -> net name (unconnected pins get "?").
  const netNameByPin = new Map<string, string>();
  for (const net of netlist.nets) for (const id of net.items) netNameByPin.set(id, net.name);

  // Pins grouped by their parent symbol's node id (the id enumeratePins emits).
  const bySym = new Map<string, typeof pins>();
  for (const p of pins) {
    const arr = bySym.get(p.symId) ?? [];
    arr.push(p);
    bySym.set(p.symId, arr);
  }

  const out: string[] = [];
  out.push(`( { ${NETLIST_HEAD} netlist created ${new Date().toISOString()} }`);

  for (const { sym, ref, index } of boardSymbols(sch)) {
    const symId = refId('symbol', sym.uuid, index);
    let footprint = symbolField(sym, 'Footprint').replace(/ /g, '_');
    if (!footprint) footprint = '$noname';
    const value = (symbolField(sym, 'Value') || '~').replace(/ /g, '_');
    out.push(` ( ${sym.uuid ?? symId} ${footprint}  ${ref} ${value}`);
    for (const pin of bySym.get(symId) ?? []) {
      if (!pin.number) continue;
      const netName = (netNameByPin.get(pin.id) ?? '?').replace(/ /g, '_');
      out.push(`  ( ${pin.number.padStart(4)} ${netName} )`);
    }
    out.push(' )');
  }

  out.push(')\n*');
  return out.join('\n');
}
