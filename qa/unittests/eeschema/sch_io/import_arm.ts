// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The schematic importers' oracle harness: what `SCH_EDIT_FRAME::importFile`
 * does with a foreign file (eeschema/files-io.cpp:1511-1620), step for step,
 * on a headless frame, then the save - so the result can be compared with the
 * `.kicad_sch` real eeschema 10.0.6 wrote for the same import
 * (~/schio_oracle/oracle.sh drives it over AT-SPI).
 *
 * importFile itself is the frame's (sch_edit_frame.ts, not ported yet); the
 * steps are listed here so the comparison is with what KiCad saves, not with
 * the plugin's bare output.
 */
import { basename, dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import type { CHOOSE_PROJECT_HANDLER } from '@ziroeda/common/io/common/plugin_common_choose_project.js';
import { MEMORY_FILESYSTEM, wxMountFileSystem } from '@ziroeda/common/wx/filefn.js';
import {
  LIBRARY_TABLE,
  LIBRARY_TABLE_SCOPE,
  LIBRARY_TABLE_TYPE,
} from '@ziroeda/common/libraries/library_table.js';
import { Pgm } from '@ziroeda/common/pgm_base.js';
import { SCH_EDIT_FRAME, type SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import { SCH_CLEANUP_FLAGS, SCHEMATIC } from '@ziroeda/eeschema/schematic.js';
import { SCH_FILE_T, SCH_IO_MGR } from '@ziroeda/eeschema/sch_io/sch_io_mgr.js';
import type { SCH_IO as SCH_IO_BASE } from '@ziroeda/eeschema/sch_io/sch_io.js';
import { SCH_IO_KICAD_SEXPR } from '@ziroeda/eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr.js';
import { ReconcileImportedFootprintFields } from '@ziroeda/eeschema/files-io.js';

const hooks: SCH_EDIT_FRAME_HOOKS = {
  crossProbingSettings: () => ({}) as ReturnType<SCH_EDIT_FRAME_HOOKS['crossProbingSettings']>,
  saveProject: () => true,
  getNetlist: () => null,
};

/** What an import left behind, as the editor's File > Save writes it. */
export interface IMPORTED {
  /** The root sheet's `.kicad_sch`. */
  root: string;
  /** Every screen's `.kicad_sch`, by its file name (the root's included). */
  sheets: Map<string, string>;
  /** What the plugin itself wrote beside the project (a symbol library, sym-lib-table). */
  written: MEMORY_FILESYSTEM;
}

/**
 * Import \a aFile (absolute) as \a aType into a project named after it, beside it.
 *
 * \a aChoose answers DIALOG_IMPORT_CHOOSE_PROJECT for a plugin that asks; KiCad's
 * preselects row 0, so the oracle runs (which press OK) take the first.
 */
export function importThroughFrame(
  aFile: string,
  aType: SCH_FILE_T,
  aChoose: CHOOSE_PROJECT_HANDLER = (aDescs) => aDescs.slice(0, 1),
): IMPORTED {
  const dir = dirname(aFile);
  const written = new MEMORY_FILESYSTEM();
  const unmount = wxMountFileSystem(dir, written);
  try {
    return importMounted(aFile, aType, aChoose, dir, written);
  } finally {
    unmount();
  }
}

function importMounted(
  aFile: string,
  aType: SCH_FILE_T,
  aChoose: CHOOSE_PROJECT_HANDLER,
  dir: string,
  written: MEMORY_FILESYSTEM,
): IMPORTED {
  const projectName = basename(aFile).replace(/\.[^.]*$/, '');
  Pgm()
    .GetSettingsManager()
    .LoadProject(join(dir, `${projectName}.kicad_pro`), null);

  // `LIBRARY_MANAGER::LoadProjectTables`: a project with no sym-lib-table on disk still
  // has its table, empty, at the path a save would write.
  const symTable = LIBRARY_TABLE.Empty(LIBRARY_TABLE_SCOPE.PROJECT, LIBRARY_TABLE_TYPE.SYMBOL);
  symTable.SetPath(join(dir, 'sym-lib-table'));
  Pgm()
    .GetLibraryManager()
    .SetTable(LIBRARY_TABLE_TYPE.SYMBOL, LIBRARY_TABLE_SCOPE.PROJECT, symTable);

  const frame = new SCH_EDIT_FRAME(hooks);
  // `std::make_unique<SCHEMATIC>( &Prj() )`
  const newSchematic = new SCHEMATIC(frame.Prj());

  const pi = SCH_IO_MGR.FindPlugin(aType) as SCH_IO_BASE;
  pi.SetFileReader((p) => {
    try {
      return new Uint8Array(readFileSync(p));
    } catch {
      return null;
    }
  });

  const chooser = pi as SCH_IO_BASE & { RegisterCallback?: (h: CHOOSE_PROJECT_HANDLER) => void };
  chooser.RegisterCallback?.(aChoose);

  const loadedSheet = pi.LoadSchematicFile(aFile, newSchematic, null, null);

  frame.SetSchematic(newSchematic);
  const schematic = frame.Schematic();

  schematic.SetTopLevelSheets([loadedSheet]);

  // re-link footprint fields to the project lib so update-from-schematic works
  ReconcileImportedFootprintFields(schematic, null, null);

  frame.SetScreen(schematic.RootScreen());

  const topSheet = schematic.GetTopLevelSheet();
  if (topSheet) topSheet.SetFileName(`${projectName}.kicad_sch`);

  frame.GetScreen()!.SetFileName(join(dir, `${projectName}.kicad_sch`));
  frame.GetScreen()!.SetContentModified();

  frame.RecalculateConnections(null, SCH_CLEANUP_FLAGS.GLOBAL_CLEANUP);

  // Only perform the dangling end test on root sheet.
  frame.GetScreen()!.TestDanglingEnds();

  frame.SetSheetNumberAndCount();

  const io = new SCH_IO_KICAD_SEXPR('eeschema');
  const sheets = new Map<string, string>();

  // SaveProject: each screen once, through the first sheet path that reaches it.
  for (const path of schematic.Hierarchy()) {
    const screen = path.LastScreen()!;
    const name = basename(screen.GetFileName());
    if (!sheets.has(name)) sheets.set(name, io.SaveSchematicFile(path.Last()!, schematic));
  }

  const root = io.SaveSchematicFile(schematic.GetTopLevelSheet()!, schematic);

  return { root, sheets, written };
}

/** One `.kicad_sch` as a multiset of its top-level items, UUIDs and instance paths normalised. */
export function topLevelItems(aText: string): string[] {
  const txt = aText
    .replace(/\(uuid "[^"]*"\)/g, '(uuid U)')
    .replace(/\(path "[^"]*"/g, '(path P')
    .replace(/\(project "[^"]*"/g, '(project X');
  const items: string[] = [];
  let cur: string[] | null = null;
  for (const ln of txt.split('\n').slice(1)) {
    // The file's own closing parenthesis belongs to no item.
    if (ln === ')') break;
    if (/^\t\(/.test(ln)) {
      if (cur) items.push(cur.join('\n'));
      cur = [ln];
    } else if (cur) cur.push(ln);
  }
  if (cur) items.push(cur.join('\n'));
  return items.sort();
}

/**
 * An instance's `(pin "n" (uuid U))` lines, sorted. The writer prints `GetRawPins()`,
 * which a freshly placed symbol fills from `std::set<SCH_PIN*> unassignedLibPins` in
 * `SCH_SYMBOL::UpdatePins` (sch_symbol.cpp:398): pointer order, i.e. wherever the heap
 * put the flattened copy's pins. Ours is library order; the SET must still match.
 */
export function pinsAsSet(aItem: string): string {
  if (!aItem.startsWith('\t(symbol')) return aItem;
  const re = /\n\t\t\(pin "[^"]*"\n\t\t\t\(uuid U\)\n\t\t\)/g;
  const pins = aItem.match(re) ?? [];
  return aItem.replace(re, '') + [...pins].sort().join('');
}

/** a - b as multisets. */
export function minus(a: readonly string[], b: readonly string[]): string[] {
  const left = new Map<string, number>();
  for (const x of b) left.set(x, (left.get(x) ?? 0) + 1);
  const out: string[] = [];
  for (const x of a) {
    const n = left.get(x) ?? 0;
    if (n > 0) left.set(x, n - 1);
    else out.push(x);
  }
  return out;
}

export { SCH_FILE_T };
