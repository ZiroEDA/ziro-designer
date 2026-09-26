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
import { ENV_VAR } from '@ziroeda/common/env_vars.js';
import { niluuid } from '@ziroeda/common/kiid.js';
import { PgmOrNull, SETTINGS_MANAGER } from '@ziroeda/common/pgm_base.js';
import { GLOBAL_SYM_LIB_NICKNAMES } from '../schematic/symbols/global_sym_lib_table.js';
import { projectSymLibTable } from '../schematic/symbols/project_sym_lib_table.js';
import type { JsonValue } from '@ziroeda/common/settings/json_settings.js';
import {
  SheetInstanceView,
  UpdateSymbolInstanceData,
  sheetKiidPath,
} from '@ziroeda/eeschema/tools/sch_sheet_path.js';
import { findProjectPro, readSchematicSetup } from '../schematic/project_settings.js';

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
/**
 * The root sheet's name, as a load gives it: the loaded project's
 * `schematic.top_level_sheets` entry for this file (PROJECT_FILE::LoadFromFile
 * gives a project that predates the list one entry named after the project),
 * else `_( "Root" )` (eeschema_helpers.cpp:131-147).
 */
function rootSheetNameOf(files: readonly RawFile[], rootFile: string, rootPro?: string): string {
  const pro = findProjectPro(files, rootPro);
  if (pro) {
    let json: JsonValue | null = null;
    try {
      json = JSON.parse(pro.text) as JsonValue;
    } catch {
      json = null;
    }
    const manager = new SETTINGS_MANAGER();
    manager.LoadProject(pro.name, json, null, false);
    const base = rootFile.split('/').pop();
    for (const info of manager.GetProject(pro.name)?.GetProjectFile().GetTopLevelSheets() ?? []) {
      // candidate.SameAs( schFile ): the entry's file is relative to the project.
      if (info.filename.split('/').pop() === base && info.name !== '') return info.name;
    }
  }
  return 'Root';
}

/**
 * `SCHEMATIC_SETTINGS::m_VariantDescriptions`: the project's
 * `schematic.variants`, `[{ name, description }]` (schematic_settings.cpp:286-300).
 */
function variantDescriptionsOf(files: readonly RawFile[], rootPro?: string): Map<string, string> {
  const out = new Map<string, string>();
  const pro = findProjectPro(files, rootPro);
  if (!pro) return out;
  let variants: unknown;
  try {
    variants = (JSON.parse(pro.text) as { schematic?: { variants?: unknown } }).schematic?.variants;
  } catch {
    return out;
  }
  if (!Array.isArray(variants)) return out;
  for (const v of variants as { name?: unknown; description?: unknown }[]) {
    if (typeof v.name === 'string' && v.name !== '')
      out.set(v.name, typeof v.description === 'string' ? v.description : '');
  }
  return out;
}

/**
 * `LIBRARY_MANAGER::GetFullURI( SYMBOL, nickname )`: the project's
 * `sym-lib-table` row first, then the global table - KiCad's default
 * `template/sym-lib-table`, every row of which is
 * `${KICAD10_SYMBOL_DIR}/<nickname>.kicad_sym`. A nickname in neither table
 * has no URI, and makeLibraries leaves it out.
 */
function symbolLibraryUri(files: readonly RawFile[]): (aNickname: string) => string | undefined {
  const projectRows = projectSymLibTable(files);
  const symbolDir = ENV_VAR.GetVersionedEnvVarName('SYMBOL_DIR');
  return (aNickname) => {
    const row = projectRows.find((r) => r.name === aNickname);
    if (row) return row.uri;
    if (!GLOBAL_SYM_LIB_NICKNAMES.has(aNickname)) return undefined;
    return `\${${symbolDir}}/${aNickname}.kicad_sym`;
  };
}

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
  const tree = buildSheetTree(docs, rootFile);
  let loadedDocs: ReadonlyMap<string, Schematic> = docs;
  const rootDoc = docs.get(rootFile);
  // An older file has no (uuid): the parser gives the root a generated one
  // (sch_io_kicad_sexpr_parser.cpp:3071) - any id does, it only has to be the
  // same for the whole load.
  const rootUuid = rootDoc ? (rootDoc.uuid ?? niluuid) : undefined;

  // SCH_SHEET_LIST::UpdateSymbolInstanceData: a file from before per-symbol
  // (instances …) keeps every reference and unit in the root's symbol_instances.
  if (rootUuid && rootDoc?.symbolInstances?.length) {
    loadedDocs = UpdateSymbolInstanceData(
      flattenSheets(tree, docs),
      docs,
      rootUuid,
      rootDoc.symbolInstances,
    );
  }

  // Each sheet instance as the exporters see it: GetRef( &sheet ) and
  // GetUnitSelection( &sheet ), so a sheet used twice has its own references.
  const sheets = flattenSheets(tree, loadedDocs).map((sheet) =>
    rootUuid
      ? { ...sheet, doc: SheetInstanceView(sheet.doc, sheetKiidPath(rootUuid, sheet.path)) }
      : sheet,
  );

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
    // SCHEMATIC::GetFileName(): the full path, the project's directory before it.
    source: `${PgmOrNull()?.GetSettingsManager().Prj().GetProjectPath() ?? ''}${rootFile}`,
    rootSheetName: rootSheetNameOf(files, rootFile, rootPro),
    variantDescriptions: variantDescriptionsOf(files, rootPro),
    libraryUri: symbolLibraryUri(files),
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
