// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/netlist_exporters/netlist_generator.cpp`
 * (`SCH_EDIT_FRAME::WriteNetListFile`): the format -> exporter dispatch the
 * Export Netlist dialog uses, so the dialog itself only ever names a format.
 *
 * Not ported: the `switch` arms for formats we do not have (PADS/CadStar were
 * both missing this exact dispatch step until this stage), the external
 * command-line generator path (desktop-only, see `dialog_export_netlist.tsx`),
 * and `AnnotatePowerSymbols`/`ReadyToNetlist` (annotation is enforced upstream
 * of the dialog here, not inside the write step).
 */

import type { Schematic, LibSymbol } from '../types.js';
import { netlistKicadXml } from './netlist_exporter_xml.js';
import { netlistOrcadPcb2 } from './netlist_exporter_orcadpcb2.js';
import { netlistPads } from './netlist_exporter_pads.js';
import { netlistCadstar } from './netlist_exporter_cadstar.js';
import { netlistAllegro, type AllegroFile } from './netlist_exporter_allegro.js';
import type { NetlistMeta } from './netlist_exporter_base.js';

export type { NetlistMeta } from './netlist_exporter_base.js';

/** The netlist formats offered by the export dialog. */
export type NetlistFormat = 'kicadxml' | 'orcadpcb2' | 'pads' | 'cadstar' | 'allegro';

export function generateNetlist(
  format: NetlistFormat,
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  meta: NetlistMeta,
): string {
  switch (format) {
    case 'kicadxml':
      return netlistKicadXml(sch, libById, meta);
    case 'pads':
      return netlistPads(sch, libById);
    case 'cadstar':
      return netlistCadstar(sch, libById, meta);
    case 'allegro':
      // Allegro also writes a devices/ directory; callers that can place more
      // than one file should use `netlistAllegroFiles` instead.
      return netlistAllegro(sch, libById, meta).netlist;
    default:
      return netlistOrcadPcb2(sch, libById, meta);
  }
}

/**
 * Every file a format produces, named relative to the netlist's folder.
 * Only Allegro produces more than one; the rest return a single entry so a
 * caller can treat all formats the same way.
 */
export function netlistFiles(
  format: NetlistFormat,
  fileName: string,
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  meta: NetlistMeta,
): AllegroFile[] {
  if (format === 'allegro') {
    const { netlist, devices } = netlistAllegro(sch, libById, meta);
    return [{ path: fileName, text: netlist }, ...devices];
  }
  return [{ path: fileName, text: generateNetlist(format, sch, libById, meta) }];
}
