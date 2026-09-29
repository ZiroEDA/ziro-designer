// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/netlist_exporters/netlist_exporter_kicad.cpp` (`NETLIST_EXPORTER_KICAD`): the
 * KiCad s-expression netlist, `Format( out, GNL_ALL | GNL_OPT_KICAD )` - the tree
 * `NETLIST_EXPORTER_XML::makeRoot` builds over the live `SCHEMATIC` and its
 * `CONNECTION_GRAPH`, printed by `XNODE::Format` (common/xnode.ts).
 *
 * This is the schematic side of "Update PCB from Schematic": pcbnew reads what this
 * writes with KICAD_NETLIST_PARSER, a file format rather than a shared object graph,
 * the separation upstream gets from kiway mail. `eeschema/cross-probing.ts`
 * (`exportKicadNetlist`) loads a project and runs it; `designer/netlist_oracle.test.ts`
 * holds it to kicad-cli, whole file, on every design in qa/data/eeschema/netlist_oracle*.
 *
 * Not ported: `WriteNetlist` (there is no file to open; a caller writes the text).
 */

import { PRETTIFIED_STRING_FORMATTER } from '@ziroeda/common/richio.js';
import { NETLIST_EXPORTER_XML } from './netlist_exporter_xml.js';

/** `NETLIST_EXPORTER_KICAD`. */
export class NETLIST_EXPORTER_KICAD extends NETLIST_EXPORTER_XML {
  /** `Format( aOut, aCtl )`: the XNODE tree, written as s-expressions. */
  Format(aCtl: number): string {
    const xroot = this.makeRoot(aCtl);
    const formatter = new PRETTIFIED_STRING_FORMATTER();
    xroot.Format(formatter);
    return formatter.Finish();
  }
}
