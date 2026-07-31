// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Fetching a netlist from the schematic, board-side. Counterparts:
 * `pcbnew/pcb_edit_frame.cpp` (PCB_EDIT_FRAME::FetchNetlistFromSchematic) and
 * `eeschema/cross-probing.cpp` (the MAIL_SCH_GET_NETLIST handler) plus
 * `eeschema/netlist_exporters/netlist_generator.cpp`
 * (SCH_EDIT_FRAME::ReadyToNetlist).
 *
 * Upstream this is a round trip over kiway mail: pcbnew asks the schematic frame for
 * a netlist, eeschema checks the schematic is fully annotated, formats it with
 * NETLIST_EXPORTER_KICAD, and pcbnew parses the string back. Here both ends are in
 * one process, but the shape is kept: the board editor never reaches into the
 * schematic model, it asks for netlist text and parses it.
 *
 * The one thing that cannot be mirrored is the modal Annotate dialog upstream opens
 * when the schematic is not annotated, the board editor cannot host the schematic's
 * dialog. Instead the annotation errors come back as a message for the caller to
 * show, which is the same information in one step fewer.
 */

import { netClassFor } from './netclass_resolve.js';
import {
  buildSheetTree,
  checkAnnotation,
  findRootFile,
  netlistKicad,
  readSchematic,
  type LibSymbol,
  type NetlistSheet,
  type Schematic,
  type SheetTreeNode,
} from '@ziroeda/eeschema';
import { loadKicadNetlist, type NETLIST } from '@ziroeda/pcbnew';
import { parse } from '@ziroeda/sexpr';
import { RPT_SEVERITY_ERROR } from '@ziroeda/common';
import { readSchematicSetup } from '../schematic/project_settings.js';

export interface RawFile {
  name: string;
  text: string;
}

export type FetchNetlistResult =
  | { ok: true; netlist: NETLIST; netlistText: string }
  | { ok: false; error: string; details?: string };

/**
 * SCH_SHEET_LIST order: the hierarchy flattened depth-first, one entry per sheet
 * *instance*, each with the instance path and the human-readable path the netlist
 * writes as a footprint's sheet name.
 */
function flattenSheets(root: SheetTreeNode, docs: ReadonlyMap<string, Schematic>): NetlistSheet[] {
  const out: NetlistSheet[] = [];
  const walk = (node: SheetTreeNode, parentNames: string): void => {
    const namePath = node.path === '/' ? '/' : `${parentNames}${node.name}/`;
    const doc = docs.get(node.file);
    if (doc) out.push({ path: node.path, namePath, file: node.file, doc });
    for (const child of node.children) walk(child, namePath);
  };
  walk(root, '/');
  return out;
}

/**
 * PCB_EDIT_FRAME::FetchNetlistFromSchematic, the project's schematic sheets, read,
 * checked for annotation and exported as a KiCad netlist.
 *
 * `annotateMessage` is the message upstream passes for the "requires a fully
 * annotated schematic" case; it prefixes the annotation errors when the check fails.
 */
export function fetchNetlistFromSchematic(
  files: readonly RawFile[],
  annotateMessage: string,
  rootPro?: string,
): FetchNetlistResult {
  // Every .kicad_sch of the project, parsed. A file that will not parse is fatal:
  // an incomplete hierarchy would silently produce a partial netlist.
  const docs = new Map<string, Schematic>();
  for (const file of files) {
    if (!/\.kicad_sch$/i.test(file.name)) continue;
    try {
      docs.set(basename(file.name), readSchematic(parse(file.text)));
    } catch (err) {
      return {
        ok: false,
        error: 'Received an error while reading the schematic.',
        details: `${basename(file.name)}: ${String(err)}`,
      };
    }
  }

  if (docs.size === 0) {
    return {
      ok: false,
      error:
        'Cannot update the PCB because this project has no schematic. In order to create or ' +
        'update PCBs from schematics, the project must contain a schematic.',
    };
  }

  const rootFile = findRootFile(docs, rootPro);
  const sheets = flattenSheets(buildSheetTree(docs, rootFile), docs);

  const libsFor = (sheet: NetlistSheet): Map<string, LibSymbol> =>
    new Map(sheet.doc.libSymbols.map((l) => [l.libId, l]));

  // ReadyToNetlist: the symbols must be annotated. Duplicate and unannotated
  // references are reported per sheet, over the whole hierarchy (SCH_SCREENS).
  const annotationErrors = checkAnnotation(
    sheets.map((s) => s.doc),
    new Map(sheets.flatMap((s) => [...libsFor(s)])),
  ).filter((line) => line.severity === RPT_SEVERITY_ERROR);

  if (annotationErrors.length > 0) {
    return {
      ok: false,
      error: annotateMessage,
      details: annotationErrors.map((l) => l.message).join('\n'),
    };
  }

  // Bus aliases and netclasses come from the project file, so bus members expand
  // and `(net … (class …))` reads the same as in the schematic editor.
  const setup = readSchematicSetup(files, rootPro);
  const busAliases = new Map(
    setup.busAliases.filter((a) => a.name).map((a) => [a.name, a.members] as const),
  );
  const assignments = setup.netClasses.assignments.filter((a) => a.pattern && a.netClass);

  const netlistText = netlistKicad({
    sheets,
    libsFor,
    source: rootFile,
    busAliases,
    netClassFor: (netName) => netClassFor(netName, assignments),
  });

  try {
    return { ok: true, netlist: loadKicadNetlist(netlistText), netlistText };
  } catch (err) {
    // Upstream: "Received an error while reading netlist." with the developer detail.
    return {
      ok: false,
      error:
        'Received an error while reading netlist. Please report this issue to the ZiroEDA team.',
      details: String(err),
    };
  }
}

/** Project files are keyed by basename, as the sheet-tree walk expects. */
const basename = (name: string): string => {
  const i = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  return i === -1 ? name : name.slice(i + 1);
};
