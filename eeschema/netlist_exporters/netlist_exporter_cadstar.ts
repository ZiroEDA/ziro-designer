// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/netlist_exporters/netlist_exporter_cadstar.cpp` (`NETLIST_EXPORTER_CADSTAR`):
 * the CadStar netlist. Every directive begins with `.`: a `.HEA` header, one `.ADD_COM`
 * per board-bound symbol (UUID order, one line per reference), then the nets.
 *
 * A net's first pin is held back and printed on the `.ADD_TER` line with the net name
 * once a second pin turns up - so a one-pin net emits nothing at all, which is how
 * upstream drops them without testing for it. The third pin onwards are bare indented
 * lines under the `.TER`.
 *
 * Held to `kicad-cli sch export netlist --format cadstar` by
 * `designer/netlist_formats_oracle.test.ts`.
 */

import { GetBuildVersion } from '@ziroeda/common/build_version.js';
import { GetISO8601CurrentDateTime } from '@ziroeda/common/string_utils.js';
import { NETLIST_EXPORTER_BASE } from './netlist_exporter_base.js';

/** `NETLIST_EXPORTER_CADSTAR`, over the live model. */
export class NETLIST_EXPORTER_CADSTAR extends NETLIST_EXPORTER_BASE {
  /** `GetISO8601CurrentDateTime()`, settable so a test can pin it. */
  m_date: () => string = GetISO8601CurrentDateTime;

  /** `WriteNetlist`'s text. */
  Format(): string {
    const StartLine = '.';
    const StartCmpDesc = `${StartLine}ADD_COM`;
    const title = `Eeschema ${GetBuildVersion()}`;

    let out = `${StartLine}HEA\n`;
    out += `${StartLine}TIM ${this.m_date()}\n`;
    out += `${StartLine}APP "${title}"\n`;
    out += '.TYP FULL\n\n';

    // Create netlist footprints section
    this.m_referencesAlreadyFound.Clear();

    for (const sheet of this.m_schematic.Hierarchy()) {
      // Process symbol attributes
      for (const symbol of this.sheetSymbolsByUuid(sheet)) {
        let footprint = symbol.GetFootprintFieldText(true, sheet, false);

        if (footprint === '') footprint = '$noname';

        out += `${StartCmpDesc}     ${symbol.GetRef(sheet)}`;
        out += `     "${symbol.GetValue(true, sheet, false).replaceAll(' ', '_')}"`;
        out += `     "${footprint}"\n`;
      }
    }

    out += '\n';
    out += this.writeListOfNets(StartLine);
    out += `\n${StartLine}END\n`;

    return out;
  }

  /** `writeListOfNets`. */
  private writeListOfNets(StartLine: string): string {
    const InitNetDesc = `${StartLine}ADD_TER`;
    const StartNetDesc = `${StartLine}TER`;
    let InitNetDescLine = '';
    let out = '';

    for (const { name, pins } of this.netsByName((aName) => `"${aName}"`)) {
      let print_ter = 0;

      for (const { ref: refText, pin: pinText } of pins) {
        // Skip power symbols and virtual symbols
        if (refText[0] === '#') continue;

        switch (print_ter) {
          case 0:
            InitNetDescLine = `\n${InitNetDesc}   ${refText}   ${pinText}     ${name}`;
            print_ter++;
            break;

          case 1:
            out += `${InitNetDescLine}\n`;
            out += `${StartNetDesc}       ${refText}   ${pinText}\n`;
            print_ter++;
            break;

          default:
            out += `            ${refText}   ${pinText}\n`;
            break;
        }
      }
    }

    return out;
  }
}
