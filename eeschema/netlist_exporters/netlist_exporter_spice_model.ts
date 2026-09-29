// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/netlist_exporters/netlist_exporter_spice_model.cpp`
 * (`NETLIST_EXPORTER_SPICE_MODEL : public NETLIST_EXPORTER_SPICE`): the SPICE
 * Model export page (`DIALOG_EXPORT_NETLIST`'s "SPICE Model" tab,
 * `InstallPageSpiceModel`, dialog_export_netlist.cpp:390-401) — the same
 * netlist as plain SPICE, wrapped as `.subckt <project name>` … `.ends`, with
 * every hierarchical label on the sheet turned into a subcircuit port
 * (`WriteHead`/`WriteTail`, netlist_exporter_spice_model.cpp:33-65) and every
 * pin on a port's net written under the port's own name instead of its
 * connection name (`GenerateItemPinNetName` overriding the base class,
 * :77-86; `readPorts`, :89-104, populated from `ReadSchematicAndLibraries`
 * overriding the base class, :68-74).
 *
 * KiCad gets this by subclassing `NETLIST_EXPORTER_SPICE` and overriding four
 * virtuals. There is no exporter *class* on this side to subclass —
 * `netlist_exporter_spice.ts`'s `generateSpiceNetlist` is one function, not
 * `NETLIST_EXPORTER_SPICE` plus a vtable — so the four overrides are realised
 * as that function's own `subcktName` branch (its own doc comment cites this
 * file's exact lines for each one; `readPorts`/`PORT_INFO`/the port-direction
 * table live there, private, because they exist only to serve that branch,
 * and this central-value rule forbids a second copy of the same
 * head/tail/port-substitution logic here just to have a file that looks
 * like a subclass).
 *
 * What *does* belong in a file of its own is what upstream's constructor and
 * `InstallPageSpiceModel` give the SPICE_MODEL page as its own identity: a
 * named entry point distinct from plain SPICE, taking the project name
 * (`Project().GetProjectName()`) rather than a raw options bag, and — per
 * `DIALOG_EXPORT_NETLIST::createNetlist`'s `NET_TYPE_SPICE_MODEL` case
 * (dialog_export_netlist.cpp:523-526) having no save-option branch — refusing
 * to carry the plain-SPICE `.save`/`.probe` checkboxes, which the base
 * function's `subcktName` branch does not filter out on its own (it would
 * honour them if a caller passed them). That is what this module is: the
 * public call site `eeschema/dialogs/dialog_export_netlist.tsx` reaches for
 * the SPICE Model tab, exactly as upstream's dialog reaches for a
 * `NETLIST_EXPORTER_SPICE_MODEL` instance rather than a `NETLIST_EXPORTER_SPICE`
 * one.
 *
 * Oracle: `kicad-cli sch export netlist --format spicemodel`, byte-identical,
 * in `qa/unittests/eeschema/netlist_exporter_spice_model.test.ts`.
 */

import type { LibSymbol, Schematic } from '../types.js';
import type { Netlist } from '../connectivity/nets.js';
import { generateSpiceNetlist } from './netlist_exporter_spice.js';

export interface SpiceModelExportOptions {
  /** GetShownText's `${VAR}` resolver, forwarded to the port/pin-name lookup. */
  resolve?: (text: string) => string;
}

/**
 * `NETLIST_EXPORTER_SPICE_MODEL::ReadSchematicAndLibraries` +
 * `DoWriteNetlist` (inherited): the schematic's hierarchical labels become
 * `.subckt <aProjectName>`'s ports, addressed by their own names rather than
 * their net's connection name. `aProjectName` is the caller's
 * `Project().GetProjectName()` (or, per `dialog_export_netlist.tsx`'s own doc
 * comment, `baseName` when the sheet has no project — that fallback is the
 * dialog's, not this function's, matching upstream taking whatever
 * `Project()` already holds).
 */
export function generateSpiceModelNetlist(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  aProjectName: string,
  netlist?: Netlist | null,
  opts: SpiceModelExportOptions = {},
): { text: string; errors: string[] } {
  return generateSpiceNetlist(sch, libById, netlist, {
    subcktName: aProjectName,
    resolve: opts.resolve,
  });
}
