// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/netlist_exporters/netlist_exporter_pads.cpp` (`NETLIST_EXPORTER_PADS`): the
 * PADS-PCB netlist. `*PART*` lists each board-bound symbol (reference padded to 16
 * columns, then the footprint - the value when there is none); `*NET*` lists each net
 * of two or more pins as `*SIGNAL*` with its `REF.PIN`s, a line break after the seventh
 * and every sixth after that.
 *
 * Held to `kicad-cli sch export netlist --format pads` by
 * `designer/netlist_formats_oracle.test.ts`.
 */

import { NETLIST_EXPORTER_BASE } from './netlist_exporter_base.js';

/** `NETLIST_EXPORTER_PADS`, over the live model. */
export class NETLIST_EXPORTER_PADS extends NETLIST_EXPORTER_BASE {
  /** `WriteNetlist`'s text. */
  Format(): string {
    let out = '*PADS-PCB*\n*PART*\n';

    // Create netlist footprints section
    this.m_referencesAlreadyFound.Clear();

    for (const sheet of this.m_schematic.Hierarchy()) {
      for (const symbol of this.sheetSymbolsByUuid(sheet)) {
        let footprint = symbol
          .GetFootprintFieldText(true, sheet, false)
          .trim()
          .replaceAll(' ', '_');

        if (footprint === '') {
          // fall back to value field
          footprint = symbol.GetValue(true, sheet, false).replaceAll(' ', '_').trim();
        }

        out += `${symbol.GetRef(sheet).padEnd(16)} ${footprint}\n`;
      }
    }

    out += '\n';
    out += this.writeListOfNets();

    return out;
  }

  /** `writeListOfNets`. */
  private writeListOfNets(): string {
    let out = '*NET*\n';

    for (const { name, pins } of this.netsByName((aName) => aName)) {
      // Skip power symbols and virtual symbols
      const netConns = pins.filter((p) => p.ref[0] !== '#').map((p) => `${p.ref}.${p.pin}`);

      // format it such that there are 6 net connections per line
      // which seems to be the standard everyone follows
      if (netConns.length > 1) {
        out += `*SIGNAL* ${name}\n`;
        let cnt = 0;

        for (const netConn of netConns) {
          out += netConn;
          out += cnt !== 0 && cnt % 6 === 0 ? '\n' : ' ';
          cnt++;
        }

        out += '\n';
      }
    }

    out += '*END*\n';

    return out;
  }
}
