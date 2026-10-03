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
 * `AnnotatePowerSymbols` inside the write step (ReadyToNetlist, below, runs it before the
 * netlist mail). There is no file to open:
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

// ---------------------------------------------------------------------------
// netlist_generator.cpp's SCH_EDIT_FRAME member, mixed into SCH_EDIT_FRAME as files-io.ts'
// are. The annotate dialog and the confirmation are the window's (SCH_EDIT_FRAME_HOOKS).
// ---------------------------------------------------------------------------

import { ANNOTATE_SCOPE_T } from '../sch_reference_list.js';
import { SYMBOL_FILTER } from '../sch_sheet_path.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import { ERC_TESTER } from '../erc/erc.js';

export class SCH_NETLIST_GENERATOR_MIXIN {
  /**
   * Check if we are ready to write a netlist file for the current schematic: power symbols
   * annotated, every other symbol annotated (asking through the annotate dialog first), and
   * no duplicate sheet names unless the user goes on anyway.
   */
  ReadyToNetlist(this: SCH_EDIT_FRAME, aAnnotateMessage: string): boolean {
    // Ensure all power symbols have a valid reference
    this.Schematic().Hierarchy().AnnotatePowerSymbols();

    // Symbols must be annotated
    if (
      this.CheckAnnotate(
        () => {},
        ANNOTATE_SCOPE_T.ANNOTATE_ALL,
        true,
        SYMBOL_FILTER.SYMBOL_FILTER_NON_POWER,
      )
    ) {
      // Schematic must be annotated: call Annotate dialog and tell the user why.
      this.ModalAnnotate(aAnnotateMessage);

      if (
        this.CheckAnnotate(
          () => {},
          ANNOTATE_SCOPE_T.ANNOTATE_ALL,
          true,
          SYMBOL_FILTER.SYMBOL_FILTER_NON_POWER,
        )
      )
        return false;
    }

    // Test duplicate sheet names:
    const erc = new ERC_TESTER(this.Schematic());

    if (erc.TestDuplicateSheetNames(false) > 0) {
      if (!this.IsOK('Error: duplicate sheet names. Continue?')) return false;
    }

    return true;
  }
}
