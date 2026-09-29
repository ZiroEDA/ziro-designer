// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/netlist_exporters/netlist_generator.cpp`
 * (`SCH_EDIT_FRAME::WriteNetListFile`): the format -> exporter dispatch the
 * Export Netlist dialog uses, so the dialog itself only ever names a format.
 * Every exporter runs over a live `SCHEMATIC` and its `CONNECTION_GRAPH`.
 *
 * Not ported: the SPICE arms (the dialog still calls `generateSpiceNetlist`,
 * netlist_exporter_spice.ts), the external command-line generator path
 * (desktop-only, see `dialog_export_netlist.tsx`), and
 * `AnnotatePowerSymbols`/`ReadyToNetlist` (annotation is enforced upstream
 * of the dialog here, not inside the write step). There is no file to open:
 * the text comes back, and the caller writes it.
 */

import type { SCHEMATIC } from '../schematic.js';
import { NETLIST_EXPORTER_XML, type NETLIST_LIBRARY_URI } from './netlist_exporter_xml.js';
import { NETLIST_EXPORTER_ORCADPCB2 } from './netlist_exporter_orcadpcb2.js';
import { NETLIST_EXPORTER_PADS } from './netlist_exporter_pads.js';
import { NETLIST_EXPORTER_CADSTAR } from './netlist_exporter_cadstar.js';
import { NETLIST_EXPORTER_ALLEGRO, type NETLIST_OUTPUT_FILE } from './netlist_exporter_allegro.js';

export type { NETLIST_OUTPUT_FILE } from './netlist_exporter_allegro.js';

/** The netlist formats offered by the export dialog. */
export type NetlistFormat = 'kicadxml' | 'orcadpcb2' | 'pads' | 'cadstar' | 'allegro';

/**
 * `WriteNetListFile( aFormat, aFullFileName, 0, … )`: every file the format writes,
 * named relative to the netlist's folder, the netlist itself first. Only Allegro
 * writes more than one (its `devices/` package files).
 *
 * @param aLibraryUri `LIBRARY_MANAGER::GetFullURI( SYMBOL, nickname )`, which the XML
 * format's `(libraries …)` asks; without it no library is listed.
 */
export function WriteNetListText(
  aFormat: NetlistFormat,
  aSchematic: SCHEMATIC,
  aFileName: string,
  aLibraryUri?: NETLIST_LIBRARY_URI,
): NETLIST_OUTPUT_FILE[] {
  switch (aFormat) {
    case 'kicadxml': {
      const exporter = new NETLIST_EXPORTER_XML(aSchematic);
      if (aLibraryUri) exporter.m_libraryUri = aLibraryUri;
      return [{ path: aFileName, text: exporter.WriteNetlistText(0) }];
    }
    case 'pads':
      return [{ path: aFileName, text: new NETLIST_EXPORTER_PADS(aSchematic).Format() }];
    case 'cadstar':
      return [{ path: aFileName, text: new NETLIST_EXPORTER_CADSTAR(aSchematic).Format() }];
    case 'allegro':
      return new NETLIST_EXPORTER_ALLEGRO(aSchematic).WriteFiles(aFileName);
    default:
      return [{ path: aFileName, text: new NETLIST_EXPORTER_ORCADPCB2(aSchematic).Format() }];
  }
}
