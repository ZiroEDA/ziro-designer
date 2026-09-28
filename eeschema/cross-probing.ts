// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The schematic half of Select on PCB, `SCH_EDIT_FRAME::SendSelectItemsToPcb`
 * (eeschema/cross-probing.cpp:325).
 *
 * KiCad does not hand the board a list of objects — the two frames are separate
 * processes, so what crosses is a `$SELECT:` packet of little text parts, one
 * per selected item:
 *
 *     F<reference>              a symbol, matched against a footprint's reference
 *     S<sheet path>             a sheet, matched as a *prefix* of a footprint's path,
 *                               which is what makes it select the subsheets too
 *     P<reference>/<pad>        a pin, matched down to the pad
 *
 * Both frames are mounted together here, so nothing has to be serialised — but
 * the packet is still what we build, because every rule about which board items
 * a schematic selection reaches is encoded in these three shapes, and inventing
 * our own would mean re-deriving the sheet-prefix rule and the pad resolution
 * from scratch. `findItemsFromSyncSelection` on the pcbnew side reads them back.
 *
 * The escaping is `EscapeString( …, CTX_IPC )`: the parts are joined with commas
 * and a path is split on slashes, so a reference containing either would tear
 * the packet apart.
 */
import { escapeIpc } from '@ziroeda/common/string_utils.js';
import { resolvePadNumbers, symbolField } from './netlist_exporters/netlist_exporter_base.js';
import { schSymbolLibraryName } from './lib_symbol_compare.js';
import { refId } from './tools/hittest.js';
import type { LibSymbol, Schematic, SchSymbol } from './types.js';
import { mmToIU } from '@ziroeda/common/eda_units.js';
import type { RawFile } from '@ziroeda/common';
import { RPT_SEVERITY_ERROR } from '@ziroeda/common';
import { netClassFor } from '@ziroeda/common/netclass_resolve.js';
import { ENV_VAR } from '@ziroeda/common/env_vars.js';
import { niluuid } from '@ziroeda/common/kiid.js';
import { PgmOrNull, SETTINGS_MANAGER } from '@ziroeda/common/pgm_base.js';
import type { JsonValue } from '@ziroeda/common/settings/json_settings.js';
import type { NetlistTextResult } from '@ziroeda/common/mail_sch_get_netlist.js';
import { parse } from '@ziroeda/sexpr';
import { buildSheetTree, findRootFile, type SheetTreeNode } from './project.js';
import { findProjectPro, readSchematicSetup } from './project_settings.js';
import { projectSymLibTable } from './project_sym_lib_table.js';
import { GLOBAL_SYM_LIB_NICKNAMES } from './global_sym_lib_table.js';
import { SheetInstanceView, UpdateSymbolInstanceData, sheetKiidPath } from './sch_sheet_path.js';
import { readSchematic } from './sch_io/sexpr/read-schematic.js';
import { netlistKicad, type NetlistSheet } from './netlist_exporters/netlist_exporter_kicad.js';
import { checkAnnotation } from './sch_reference_list.js';

/** `<symbolRefId>:pin<k>` -> its two halves; null for anything else. */
function pinRef(id: string): { owner: string; index: number } | null {
  const at = id.lastIndexOf(':pin');
  if (at === -1) return null;
  const index = Number(id.slice(at + 4));
  if (!Number.isInteger(index) || index < 0) return null;
  return { owner: id.slice(0, at), index };
}

/**
 * The pin number a `:pin<k>` id names.
 *
 * `k` counts the pins of the units this placement draws, hidden ones included,
 * which is `computePinSegments`' enumeration — the one the ids were minted from.
 * Counting any other set would silently address the wrong pad.
 */
function pinNumberAt(
  sym: SchSymbol,
  lib: LibSymbol | undefined,
  index: number,
): string | undefined {
  let k = 0;
  for (const u of lib?.units ?? []) {
    if (
      (u.unit !== 0 && u.unit !== sym.unit) ||
      (u.bodyStyle !== 0 && u.bodyStyle !== sym.bodyStyle)
    )
      continue;
    for (const pin of u.pins) if (k++ === index) return pin.number;
  }
  return undefined;
}

/**
 * The `$SELECT:` parts for `selection`, in KiCad's order — the order decides
 * which board item the view ends up centred on, so it is carried through rather
 * than sorted.
 *
 * `sheetPath` is the current sheet's instance path (`SCH_SHEET_PATH::PathAsString`,
 * "/" at the root and slash-terminated below it), which a sheet part is prefixed
 * with so the board can tell two instances of the same sheet apart.
 *
 * Items that are none of the three kinds are skipped, matching the `default:
 * break` of the switch upstream — that is why the menu entry is conditioned on
 * `crossProbingSelection` and not merely on a non-empty selection.
 */
export function syncSelectionParts(
  doc: Schematic,
  selection: ReadonlySet<string>,
  sheetPath: string,
  libById?: ReadonlyMap<string, LibSymbol>,
): string[] {
  const symbolAt = new Map(doc.symbols.map((s, i) => [refId('symbol', s.uuid, i), i]));
  const sheetAt = new Map(doc.sheets.map((s, i) => [refId('sheet', s.uuid, i), i]));
  const parts: string[] = [];

  for (const id of selection) {
    const si = symbolAt.get(id);
    if (si !== undefined) {
      parts.push(`F${escapeIpc(symbolField(doc.symbols[si]!, 'Reference'))}`);
      continue;
    }

    const hi = sheetAt.get(id);
    if (hi !== undefined) {
      // The sheet's own uuid, appended to the path of the sheet it sits on:
      // together they are the path prefix every footprint inside it carries.
      const sheet = doc.sheets[hi]!;
      parts.push(`S${sheetPath}${sheet.uuid ?? ''}`);
      continue;
    }

    const pin = pinRef(id);
    const owner = pin === null ? undefined : symbolAt.get(pin.owner);
    if (pin === null || owner === undefined) continue;

    const sym = doc.symbols[owner]!;
    const lib = libById?.get(schSymbolLibraryName(sym));
    const number = pinNumberAt(sym, lib, pin.index);
    if (number === undefined) continue;

    const ref = escapeIpc(symbolField(sym, 'Reference'));
    // A mapped pin can stand for several pads (`[1,2]`), and upstream highlights
    // every one of them rather than picking the first.
    for (const pad of resolvePadNumbers(number, sym, lib, symbolField(sym, 'Footprint'), undefined))
      parts.push(`P${ref}/${escapeIpc(pad)}`);
  }

  return parts;
}

/**
 * The inbound half: the schematic items a `$SELECT:` packet FROM the board
 * names, as selection ids.
 *
 * `SCH_EDIT_FRAME::KiwayMailIn`'s `MAIL_SELECTION` arm parses the same three
 * part letters `syncSelectionParts` writes, and hands the items to
 * `SCH_SELECTION_TOOL::SyncSelection` (`sch_selection_tool.cpp:3464-3534`). The
 * shape deliberately mirrors pcbnew's `findItemsFromSyncSelection`, because the
 * two are the same function pointed the other way — and the letters have to be
 * read exactly as they were written or a round trip silently selects nothing.
 *
 * Unknown letters are ignored rather than failing the packet, as upstream's
 * `default: break` does: a message from a newer board selects what it can.
 */
export function findSymbolsFromSyncSelection(
  doc: Schematic,
  parts: readonly string[],
  sheetPath: string,
  libById?: ReadonlyMap<string, LibSymbol>,
): string[] {
  const hits: { order: number; id: string }[] = [];

  doc.symbols.forEach((sym, si) => {
    // Compared in the ESCAPED form the parts carry, exactly as the outbound
    // half writes it; `escapeIpc` is injective, so this is the same test as
    // unescaping both sides.
    const ref = escapeIpc(symbolField(sym, 'Reference'));
    const id = refId('symbol', sym.uuid, si);

    parts.forEach((part, order) => {
      if (part === '') return;
      const data = part.slice(1);

      switch (part[0]) {
        case 'F':
          if (data === ref) hits.push({ order, id });
          break;
        case 'P': {
          // `<ref>/<pad>`: the reference comes first, so the separating slash is
          // the one after it and any slash of its own arrives escaped.
          if (!data.startsWith(`${ref}/`)) break;
          const pad = unescapeIpc(data.slice(ref.length + 1));
          const lib = libById?.get(schSymbolLibraryName(sym));
          const pins = lib ? lib.units.flatMap((u) => u.pins) : [];
          pins.forEach((_pin, pi) => {
            const number = pinNumberAt(sym, lib, pi);
            if (number === undefined) return;
            const pads = resolvePadNumbers(
              number,
              sym,
              lib,
              symbolField(sym, 'Footprint'),
              undefined,
            );
            // The whole SYMBOL is what a pad probe selects here. Upstream
            // selects the pin and then `FocusOnItem`s it, but a pin is not
            // independently selectable in this port, and selecting its symbol
            // is what `select( item )` falls back to for a child whose parent
            // is on the draw list (`sch_selection_tool.cpp:3506-3512`).
            if (pads.includes(pad)) hits.push({ order, id });
          });
          break;
        }
        default:
          break;
      }
    });
  });

  doc.sheets.forEach((sheet, hi) => {
    // The path a footprint inside this sheet carries: the sheet's own uuid
    // appended to the path of the sheet it sits on — the same string the
    // outbound half writes for `S`.
    const own = `${sheetPath}${sheet.uuid ?? ''}`;
    const id = refId('sheet', sheet.uuid, hi);
    parts.forEach((part, order) => {
      if (part[0] !== 'S') return;
      // A PREFIX match, which is what makes a sheet probe reach its subsheets.
      if (own.startsWith(part.slice(1))) hits.push({ order, id });
    });
  });

  hits.sort((a, b) => a.order - b.order);
  // One part can name a pin of a symbol another part already selected, and the
  // ids become the selection, so they have to be unique.
  return [...new Set(hits.map((h) => h.id))];
}

/** The three CTX_IPC escapes, undone — pcbnew's `unescapeIpc`, pointed back. */
function unescapeIpc(source: string): string {
  return source.replaceAll('{slash}', '/').replaceAll('{comma}', ',').replaceAll('{dblquote}', '"');
}

/**
 * The selection a probe should apply, or null to refuse it.
 *
 * `case MAIL_SELECTION: if( !...on_selection ) break;` — the check sits on
 * `MAIL_SELECTION` alone and `MAIL_SELECTION_FORCE` falls through below it, so
 * a FORCED probe (the cross-probe menu commands) ignores the preference. Same
 * split as pcbnew's `crossProbeSelection`, because it is the same code.
 */
export function crossProbeSchSelection(
  cfg: { on_selection: boolean },
  doc: Schematic,
  parts: readonly string[],
  sheetPath: string,
  libById?: ReadonlyMap<string, LibSymbol>,
  force = false,
): string[] | null {
  if (!cfg.on_selection && !force) return null;
  return findSymbolsFromSyncSelection(doc, parts, sheetPath, libById);
}

/**
 * `SCH_SELECTION_TOOL::ZoomFitCrossProbeBBox`'s LUT
 * (`sch_selection_tool.cpp:3391-3397`), mapping "how many default text heights
 * tall is this symbol" to "how much bigger than itself to draw the view".
 *
 * It is NOT pcbnew's table. The two frames run the same algorithm over
 * different numbers — a resistor wants sixteen times its own height of
 * schematic around it where a footprint wants eight — and upstream keeps two
 * copies of the function for exactly that reason. Sharing one table would be
 * the drift, not the fix.
 */
const ZOOM_LUT: readonly (readonly [number, number])[] = [
  [1.25, 16],
  [2.5, 12],
  [5, 8],
  [6, 6],
  [10, 4],
  [20, 2],
  [40, 1.5],
  [100, 1],
];

/** `DEFAULT_TEXT_SIZE` in schematic IU — the yardstick the ratio is bent against. */
const TEXT_HEIGHT = mmToIU(50 * 0.0254);

/** Linear interpolation within the LUT; below the first entry, the first value. */
function bendRatio(compRatio: number): number {
  const first = ZOOM_LUT[0]!;
  if (compRatio < first[0]) return first[1];
  for (let i = 0; i < ZOOM_LUT.length - 1; i++) {
    const a = ZOOM_LUT[i]!;
    const b = ZOOM_LUT[i + 1]!;
    if (a[0] <= compRatio && b[0] >= compRatio)
      return a[1] + ((b[1] - a[1]) * (compRatio - a[0])) / (b[0] - a[0]);
  }
  // "Large symbol default is last LUT entry (1:1)."
  return ZOOM_LUT[ZOOM_LUT.length - 1]![1];
}

/**
 * The new view scale a cross-probe should zoom to, or null to leave the zoom
 * alone — `ZoomFitCrossProbeBBox` (`sch_selection_tool.cpp:3362-3461`).
 *
 * The null is upstream's own restraint: "Try not to zoom on every cross-probe;
 * it gets very noisy", so a ratio already between 0.5 and 1.0 changes nothing.
 */
export function schCrossProbeZoomScale(
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  screen: { x: number; y: number },
  scale: number,
): number | null {
  const width = bbox.maxX - bbox.minX;
  if (width === 0) return null;

  // `bbox.Inflate( KiROUND( GetWidth() * 0.2f ) )` grows each side, so the size
  // gains twice the delta.
  const inflate = Math.round(width * 0.2);
  const bbSize = { x: width + 2 * inflate, y: bbox.maxY - bbox.minY + 2 * inflate };
  const screenSize = { x: Math.max(10, Math.abs(screen.x)), y: Math.max(10, screen.y) };

  let ratio = Math.max(-1, Math.abs(bbSize.y / screenSize.y));
  const kicadRatio = Math.max(Math.abs(bbSize.x / screenSize.x), Math.abs(bbSize.y / screenSize.y));
  let compRatioBent = bendRatio(bbSize.y / TEXT_HEIGHT);

  // A symbol far wider than it is tall would be cut off at the sides by the
  // height-driven ratio, so those fall back to the plain fit.
  if (bbSize.x > screenSize.x * ratio * compRatioBent) {
    ratio = kicadRatio;
    compRatioBent = 1.0;
  }

  ratio *= compRatioBent;
  return ratio < 0.5 || ratio > 1.0 ? scale / ratio : null;
}

// ---------------------------------------------------------------------------
// MAIL_SCH_GET_NETLIST (cross-probing.cpp:1027-1045): the headless handler,
// what an off-screen SCH_EDIT_FRAME would answer. pcbnew/netlist_from_schematic.ts
// registers this as its provider, since pcbnew may not import eeschema
// directly (KiCad's pcbnew never links eeschema either — only through KIWAY).
// ---------------------------------------------------------------------------

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

/** Project files are keyed by basename, as the sheet-tree walk expects. */
const basename = (name: string): string => {
  const i = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  return i === -1 ? name : name.slice(i + 1);
};

/**
 * `MAIL_SCH_GET_NETLIST` (cross-probing.cpp:1027): the project's schematic
 * sheets, read, checked for annotation (`ReadyToNetlist`,
 * netlist_generator.cpp) and exported as a KiCad netlist string
 * (`NETLIST_EXPORTER_KICAD::Format`). `annotateMessage` is the message
 * upstream passes for the "requires a fully annotated schematic" case; it
 * prefixes the annotation errors when the check fails.
 *
 * Text only — the board side (`pcbnew/netlist_from_schematic.ts`) parses it
 * into its own `NETLIST`, the same as the real KIWAY mail's payload is a
 * plain string both ways.
 */
export function formatSchematicNetlist(
  files: readonly RawFile[],
  annotateMessage: string,
  rootPro?: string,
): NetlistTextResult {
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

  return { ok: true, netlistText };
}
