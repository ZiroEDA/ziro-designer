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
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { KIWAY_MAIL_EVENT } from '@ziroeda/common/kiway_mail.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';
import { SCH_EDIT_FRAME, type SCH_EDIT_FRAME_HOOKS } from './sch_edit_frame.js';
import { escapeIpc, unescapeString } from '@ziroeda/common/string_utils.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { SCH_ITEM } from './sch_item.js';
import type { SCH_PIN } from './sch_pin.js';
import { type SCH_REFERENCE, SCH_REFERENCE_LIST } from './sch_reference_list.js';
import { type SCH_SHEET_LIST, type SCH_SHEET_PATH, SYMBOL_FILTER } from './sch_sheet_path.js';
import { resolvePadNumbers, symbolField } from './netlist_exporters/netlist_exporter_base.js';
import { schSymbolLibraryName } from './lib_symbol.js';
import { refId } from './tools/hittest.js';
import type { LibSymbol, Schematic, SchSymbol } from './types.js';
import { mmToIU } from '@ziroeda/common/eda_units.js';
import type { RawFile } from '@ziroeda/common';
import { ENV_VAR } from '@ziroeda/common/env_vars.js';
import { PgmOrNull } from '@ziroeda/common/pgm_base.js';
import type { JsonValue } from '@ziroeda/common/settings/json_settings.js';
import type { NetlistTextResult } from '@ziroeda/common/mail_sch_get_netlist.js';
import { findProjectPro } from './project_settings.js';
import { projectSymLibTable } from './project_sym_lib_table.js';
import { GLOBAL_SYM_LIB_NICKNAMES } from './global_sym_lib_table.js';
import { GNL_ALL, GNL_T } from './netlist_exporters/netlist_exporter_xml.js';
import { NETLIST_EXPORTER_KICAD } from './netlist_exporters/netlist_exporter_kicad.js';
import { LoadSchematic } from './eeschema_helpers.js';
import type { SCHEMATIC } from './schematic.js';
import { PROJECT } from '@ziroeda/common/project.js';
import { PROJECT_FILE } from '@ziroeda/common/project/project_file.js';

// ---------------------------------------------------------------------------
// MAIL_SCH_GET_NETLIST (cross-probing.cpp:1027-1045): the headless handler,
// what an off-screen SCH_EDIT_FRAME would answer. pcbnew/netlist_from_schematic.ts
// registers this as its provider, since pcbnew may not import eeschema
// directly (KiCad's pcbnew never links eeschema either — only through KIWAY).
// ---------------------------------------------------------------------------

/**
 * `LIBRARY_MANAGER::GetFullURI( SYMBOL, nickname )`: the project's
 * `sym-lib-table` row first, then the global table - KiCad's default
 * `template/sym-lib-table`, every row of which is
 * `${KICAD10_SYMBOL_DIR}/<nickname>.kicad_sym`. A nickname in neither table
 * has no URI, and makeLibraries leaves it out.
 */
export function symbolLibraryUri(
  files: readonly RawFile[],
): (aNickname: string) => string | undefined {
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
 * `MAIL_SCH_GET_NETLIST` with no schematic player running: what upstream does then.
 * `PCB_EDIT_FRAME::TestStandalone` asks `Kiway().Player( FRAME_SCH, true )` for an off-screen
 * `SCH_EDIT_FRAME`, which opens the project (`OpenProjectFiles`) and answers the mail
 * (`ReadyToNetlist`, then `NETLIST_EXPORTER_KICAD`). A frame here mounts asynchronously, so
 * this builds that frame itself: no window behind it, so no Annotate dialog and no
 * confirmation; an unannotated schematic is refused with the annotate message alone, as
 * upstream reports a payload that comes back unchanged.
 *
 * The root sheet is the project's (`<project>.kicad_sch`); with no project file, the one sheet
 * no other sheet names.
 */
export function formatSchematicNetlist(
  files: readonly RawFile[],
  annotateMessage: string,
  rootPro?: string,
): NetlistTextResult {
  const sheets = files.filter((f) => /\.kicad_sch$/i.test(f.name));

  if (sheets.length === 0) {
    return {
      ok: false,
      error:
        'Cannot update the PCB because this project has no schematic. In order to create or ' +
        'update PCBs from schematics, the project must contain a schematic.',
    };
  }

  const pro = findProjectPro(files, rootPro);
  const names = sheets.map((f) => basename(f.name));
  const proSheet = pro ? basename(pro.name).replace(/\.kicad_pro$/i, '.kicad_sch') : null;
  let rootFile = proSheet && names.includes(proSheet) ? proSheet : null;

  if (!rootFile) {
    const referenced = new Set<string>();

    for (const f of sheets)
      for (const m of f.text.matchAll(/\(property "Sheetfile" "([^"]*)"/g))
        referenced.add(basename(m[1]!));

    rootFile = names.find((n) => !referenced.has(n)) ?? names[0]!;
  }

  const projectName = (pro ? basename(pro.name) : rootFile).replace(/\.[^.]*$/, '');
  const dir = `/${projectName}`;
  const byName = new Map(files.map((f) => [basename(f.name), f.text]));

  const frame = new SCH_EDIT_FRAME({
    crossProbingSettings: () => ({}) as ReturnType<SCH_EDIT_FRAME_HOOKS['crossProbingSettings']>,
    saveProject: () => false,
    syncLiveSchematic: () => true,
    symbolLibraryUri: symbolLibraryUri(files),
  });

  if (
    !frame.OpenProjectFiles(
      [`${dir}/${rootFile}`],
      0,
      (p: string) => byName.get(basename(p)) ?? null,
    )
  ) {
    return {
      ok: false,
      error: 'Received an error while reading the schematic.',
      details: rootFile,
    };
  }

  const payload = { value: annotateMessage };
  frame.KiwayMailIn(new KIWAY_MAIL_EVENT(FRAME_T.FRAME_SCH, MAIL_T.MAIL_SCH_GET_NETLIST, payload));

  if (payload.value === annotateMessage) return { ok: false, error: annotateMessage };

  return { ok: true, netlistText: payload.value };
}

/**
 * The KiCad netlist of a project, the way `kicad-cli sch export netlist` writes it
 * (`EESCHEMA_JOBS_HANDLER::JobExportNetlist`): `EESCHEMA_HELPERS::LoadSchematic`, then
 * `NETLIST_EXPORTER_KICAD` over its `CONNECTION_GRAPH`. Annotation is not checked here:
 * the CLI only warns, and the Update PCB path ({@link formatSchematicNetlist}) refuses
 * before it gets this far.
 */
export function exportKicadNetlist(
  files: readonly RawFile[],
  rootFile: string,
  rootPro?: string,
): NetlistTextResult {
  const schematic = loadProjectSchematic(files, rootFile, rootPro);

  if (!schematic) {
    return {
      ok: false,
      error: 'Received an error while reading the schematic.',
      details: rootFile,
    };
  }

  const exporter = new NETLIST_EXPORTER_KICAD(schematic);
  exporter.m_libraryUri = symbolLibraryUri(files);

  return { ok: true, netlistText: exporter.Format(GNL_ALL | GNL_T.GNL_OPT_KICAD) };
}

/**
 * The project's root schematic as a live `SCHEMATIC` with its connection graph built:
 * the `.kicad_pro` beside it (or an empty project), every sheet read from `files`.
 * Files are found by base name: a project's sheets sit in one folder here.
 */
export function loadProjectSchematic(
  files: readonly RawFile[],
  rootFile: string,
  rootPro?: string,
): SCHEMATIC | null {
  // SCHEMATIC::GetFileName(): the full path, the project's directory before it.
  const dir = PgmOrNull()?.GetSettingsManager().Prj().GetProjectPath() || '/';
  const pro = findProjectPro(files, rootPro);
  const proPath = `${dir}${pro ? basename(pro.name) : rootFile.replace(/\.kicad_sch$/i, '.kicad_pro')}`;

  const project = new PROJECT();
  project.setProjectFullName(proPath);
  const projectFile = new PROJECT_FILE(proPath);
  project.setProjectFile(projectFile);

  if (pro) {
    try {
      projectFile.LoadFromFile(JSON.parse(pro.text) as JsonValue);
    } catch {
      // An unreadable project file is a default project, as a missing one is.
    }
  }

  const byName = new Map(files.map((f) => [basename(f.name), f.text]));

  return LoadSchematic(
    `${dir}${rootFile}`,
    project,
    (aPath) => byName.get(basename(aPath)) ?? null,
  );
}

type SYNC_SYM_MAP = Map<string, SCH_REFERENCE[]>;
type SYNC_PIN_MAP = Map<string, Map<string, SCH_PIN | null>>;

/** A SCH_SHEET_PATH as an unordered_map key: its KIID path (operator== compares those). */
const pathKey = (aPath: SCH_SHEET_PATH): string => aPath.Path().AsString();

/**
 * `findSymbolsAndPins( aSchematicSheetList, aSheetPath, aSyncSymMap, aSyncPinMap, aRecursive )`
 * (cross-probing.cpp:474): the symbols on \a aSheetPath whose references the sync maps want,
 * whole or by pin.
 */
export function findSymbolsAndPins(
  aSchematicSheetList: SCH_SHEET_LIST,
  aSheetPath: SCH_SHEET_PATH,
  aSyncSymMap: SYNC_SYM_MAP,
  aSyncPinMap: SYNC_PIN_MAP,
  aRecursive = false,
): boolean {
  if (aRecursive) {
    // Iterate over children
    for (const candidate of aSchematicSheetList) {
      if (candidate.equals(aSheetPath) || !candidate.IsContainedWithin(aSheetPath)) continue;

      findSymbolsAndPins(aSchematicSheetList, candidate, aSyncSymMap, aSyncPinMap, aRecursive);
    }
  }

  const references = new SCH_REFERENCE_LIST();

  aSheetPath.GetSymbols(references, SYMBOL_FILTER.SYMBOL_FILTER_NON_POWER, true);

  for (let ii = 0; ii < references.GetCount(); ii++) {
    const schRef = references.at(ii);

    if (schRef.IsSplitNeeded()) schRef.Split();

    const symbol = schRef.GetSymbol();
    const refNum = schRef.GetRefNumber();
    const fullRef = schRef.GetRef() + refNum;

    // Skip power symbols
    if (fullRef.startsWith('#')) continue;

    // Unannotated symbols are not supported
    if (refNum === '?') continue;

    // Look for whole footprint
    const symMatch = aSyncSymMap.get(fullRef);

    if (symMatch) {
      symMatch.push(schRef);

      // Whole footprint was selected, no need to select pins
      continue;
    }

    // Look for pins
    const pinMap = aSyncPinMap.get(fullRef);

    if (pinMap) {
      const pinsOnSheet = symbol.GetPins(aSheetPath);

      for (const pin of pinsOnSheet) {
        const pinUnit = pin.GetLibPin()!.GetUnit();

        if (pinUnit > 0 && pinUnit !== schRef.GetUnit()) continue;

        if (pinMap.has(pin.GetNumber())) pinMap.set(pin.GetNumber(), pin);
      }
    }
  }

  return false;
}

/**
 * `sheetContainsOnlyWantedItems( ... )` (cross-probing.cpp:553): every annotated, non-power symbol
 * on \a aSheetPath and below is wanted whole.
 */
export function sheetContainsOnlyWantedItems(
  aSchematicSheetList: SCH_SHEET_LIST,
  aSheetPath: SCH_SHEET_PATH,
  aSyncSymMap: SYNC_SYM_MAP,
  aSyncPinMap: SYNC_PIN_MAP,
  aCache: Map<string, boolean>,
): boolean {
  const cached = aCache.get(pathKey(aSheetPath));

  if (cached !== undefined) return cached;

  const emplace = (aValue: boolean): boolean => {
    // std::unordered_map::emplace keeps an existing entry.
    if (!aCache.has(pathKey(aSheetPath))) aCache.set(pathKey(aSheetPath), aValue);
    return aValue;
  };

  // Iterate over children
  for (const candidate of aSchematicSheetList) {
    if (candidate.equals(aSheetPath) || !candidate.IsContainedWithin(aSheetPath)) continue;

    const childRet = sheetContainsOnlyWantedItems(
      aSchematicSheetList,
      candidate,
      aSyncSymMap,
      aSyncPinMap,
      aCache,
    );

    if (!childRet) return emplace(false);
  }

  const references = new SCH_REFERENCE_LIST();
  aSheetPath.GetSymbols(references, SYMBOL_FILTER.SYMBOL_FILTER_NON_POWER, true);

  // Empty sheet, obviously do not contain wanted items
  if (references.GetCount() === 0) return emplace(false);

  for (let ii = 0; ii < references.GetCount(); ii++) {
    const schRef = references.at(ii);

    if (schRef.IsSplitNeeded()) schRef.Split();

    const refNum = schRef.GetRefNumber();
    const fullRef = schRef.GetRef() + refNum;

    // Skip power symbols
    if (fullRef.startsWith('#')) continue;

    // Unannotated symbols are not supported
    if (refNum === '?') continue;

    if (!aSyncSymMap.has(fullRef)) return emplace(false); // Some symbol is not wanted.

    if (aSyncPinMap.has(fullRef)) return emplace(false); // Looking for specific pins, so can't be mapped
  }

  return emplace(true);
}

/**
 * `findItemsFromSyncSelection( aSchematic, aSyncStr, aFocusOnFirst )` (cross-probing.cpp:628): the
 * sheet to show, the item to focus and the items to select for a `$SELECT:` sync string of
 * `F<ref>` and `P<ref>/<pad>` entries - the current sheet tried first.
 */
export function findItemsFromSyncSelection(
  aSchematic: SCHEMATIC,
  aSyncStr: string,
  aFocusOnFirst: boolean,
): [SCH_SHEET_PATH, SCH_ITEM | null, SCH_ITEM[]] | null {
  const syncArray = aSyncStr.split(',').filter((t) => t !== '');

  const syncSymMap: SYNC_SYM_MAP = new Map();
  const syncPinMap: SYNC_PIN_MAP = new Map();
  const fullyWantedCache = new Map<string, boolean>();

  let focusSymbol: string | null = null;
  let focusPin: [string, string] | null = null;
  const focusItemResults = new Map<string, SCH_ITEM[]>();

  const allSheetsList = aSchematic.Hierarchy();

  // In orderedSheets, the current sheet comes first.
  const orderedSheets: SCH_SHEET_PATH[] = [aSchematic.CurrentSheet()];

  for (const sheetPath of allSheetsList) {
    if (!sheetPath.equals(aSchematic.CurrentSheet())) orderedSheets.push(sheetPath);
  }

  // Init sync maps from the sync string
  for (let i = 0; i < syncArray.length; i++) {
    const syncEntry = syncArray[i]!;
    const syncData = syncEntry.substring(1);

    switch (syncEntry[0]) {
      case 'F': {
        // Select by footprint: F<Reference>
        const symRef = unescapeString(syncData);

        if (aFocusOnFirst && i === 0) focusSymbol = symRef;

        syncSymMap.set(symRef, []);
        break;
      }

      case 'P': {
        // Select by pad: P<Footprint reference>/<Pad number>
        const slash = syncData.indexOf('/');
        const symRef = unescapeString(slash < 0 ? syncData : syncData.substring(0, slash));
        const padNum = unescapeString(slash < 0 ? '' : syncData.substring(slash + 1));

        if (aFocusOnFirst && i === 0) focusPin = [symRef, padNum];

        if (!syncPinMap.has(symRef)) syncPinMap.set(symRef, new Map());

        syncPinMap.get(symRef)!.set(padNum, null);
        break;
      }

      default:
        break;
    }
  }

  // Lambda definitions
  const flattenSyncMaps = (): SCH_ITEM[] => {
    const allVec: SCH_ITEM[] = [];

    for (const symbols of syncSymMap.values()) {
      for (const ref of symbols) allVec.push(ref.GetSymbol());
    }

    for (const pinMap of syncPinMap.values()) {
      for (const pin of pinMap.values()) {
        if (pin) allVec.push(pin);
      }
    }

    return allVec;
  };

  const clearSyncMaps = (): void => {
    for (const symbols of syncSymMap.values()) symbols.length = 0;

    for (const pins of syncPinMap.values()) {
      for (const number of pins.keys()) pins.set(number, null);
    }
  };

  const syncMapsValuesEmpty = (): boolean => {
    for (const symbols of syncSymMap.values()) {
      if (symbols.length > 0) return false;
    }

    for (const pins of syncPinMap.values()) {
      for (const pin of pins.values()) {
        if (pin) return false;
      }
    }

    return true;
  };

  const checkFocusItems = (aSheet: SCH_SHEET_PATH): void => {
    const push = (aItem: SCH_ITEM): void => {
      const key = pathKey(aSheet);

      if (!focusItemResults.has(key)) focusItemResults.set(key, []);

      focusItemResults.get(key)!.push(aItem);
    };

    if (focusSymbol !== null) {
      const found = syncSymMap.get(focusSymbol);

      if (found && found.length > 0) push(found[0]!.GetSymbol());
    } else if (focusPin) {
      const found = syncPinMap.get(focusPin[0]);
      const pin = found?.get(focusPin[1]);

      if (pin) push(pin);
    }
  };

  const makeRetForSheet = (
    aSheet: SCH_SHEET_PATH,
    aFocusItem: SCH_ITEM | null,
  ): [SCH_SHEET_PATH, SCH_ITEM | null, SCH_ITEM[]] => {
    clearSyncMaps();

    // Fill sync maps
    findSymbolsAndPins(allSheetsList, aSheet, syncSymMap, syncPinMap);
    const itemsVector = flattenSyncMaps();

    // Add fully wanted sheets to vector
    for (const item of aSheet.LastScreen()!.Items().OfType(KICAD_T.SCH_SHEET_T)) {
      const kiidPath = aSheet.Path().Clone();
      kiidPath.push_back(item.m_Uuid);

      const subsheetPath = allSheetsList.GetSheetPathByKIIDPath(kiidPath);

      if (!subsheetPath) continue;

      if (
        sheetContainsOnlyWantedItems(
          allSheetsList,
          subsheetPath,
          syncSymMap,
          syncPinMap,
          fullyWantedCache,
        )
      )
        itemsVector.push(item as SCH_ITEM);
    }

    return [aSheet, aFocusItem, itemsVector];
  };

  if (aFocusOnFirst) {
    for (const sheetPath of orderedSheets) {
      clearSyncMaps();

      findSymbolsAndPins(allSheetsList, sheetPath, syncSymMap, syncPinMap);

      checkFocusItems(sheetPath);
    }

    if (focusItemResults.size > 0) {
      for (const sheetPath of orderedSheets) {
        const items = focusItemResults.get(pathKey(sheetPath)) ?? [];

        if (items.length > 0) return makeRetForSheet(sheetPath, items[0]!);
      }
    }
  } else {
    for (const sheetPath of orderedSheets) {
      clearSyncMaps();

      findSymbolsAndPins(allSheetsList, sheetPath, syncSymMap, syncPinMap);

      // Something found on sheet
      if (!syncMapsValuesEmpty()) return makeRetForSheet(sheetPath, null);
    }
  }

  return null;
}
