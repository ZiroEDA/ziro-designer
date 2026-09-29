// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/netlist_exporters/netlist_exporter_orcadpcb2.cpp`
 * (`NETLIST_EXPORTER_ORCADPCB2`): the legacy OrcadPCB2 netlist. One `( /<path><uuid>
 * <footprint>  <ref> <value>` block per board-bound symbol of every sheet, in UUID
 * order, each with its `CreatePinList` pins (number right-aligned in four columns, then
 * the net name, spaces turned to underscores).
 *
 * Held to `kicad-cli sch export netlist --format orcadpcb2` by
 * `designer/netlist_formats_oracle.test.ts`.
 */

import { GetISO8601CurrentDateTime } from '@ziroeda/common/string_utils.js';
import { NETLIST_EXPORTER_BASE } from './netlist_exporter_base.js';

/** `NETLIST_HEAD_STRING` (netlist.h:54). */
export const NETLIST_HEAD_STRING = 'EESchema Netlist Version 1.1';

/** `NETLIST_EXPORTER_ORCADPCB2`, over the live model. */
export class NETLIST_EXPORTER_ORCADPCB2 extends NETLIST_EXPORTER_BASE {
  /** `GetISO8601CurrentDateTime()`, settable so a test can pin it. */
  m_date: () => string = GetISO8601CurrentDateTime;

  /** `WriteNetlist`'s text. */
  Format(): string {
    let out = `( { ${NETLIST_HEAD_STRING} created  ${this.m_date()} }\n`;

    // Create netlist footprints section
    this.m_referencesAlreadyFound.Clear();

    for (const sheet of this.m_schematic.Hierarchy()) {
      // Process symbol attributes
      for (const symbol of this.sheetSymbolsByUuid(sheet)) {
        const pins = this.CreatePinList(symbol, sheet, true);

        let footprint = symbol.GetFootprintFieldText(true, sheet, false).replaceAll(' ', '_');

        if (footprint === '') footprint = '$noname';

        out += ` ( ${sheet.PathAsString() + symbol.m_Uuid} ${footprint}`;
        out += `  ${symbol.GetRef(sheet)}`;
        out += ` ${symbol.GetValue(true, sheet, false).replaceAll(' ', '_')}`;
        out += '\n';

        // Write pin list:
        for (const pin of pins) {
          if (pin.num === '') continue; // Erased pin in list

          const netName = pin.netName.replaceAll(' ', '_');

          // Legacy OrcadPCB2 right-aligns the pin number in a 4-column field.
          out += `  ( ${pin.num.padStart(4)} ${netName} )\n`;
        }

        out += ' )\n';
      }
    }

    out += ')\n*\n';

    return out;
  }
}
