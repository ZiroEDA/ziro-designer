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

/**
 * Import \a aFile (absolute) as \a aType into a project named after it, beside it, and
 * return the root sheet's `.kicad_sch` text as the editor's save writes it.
 */
export function importThroughFrame(aFile: string, aType: SCH_FILE_T): string {
  const dir = dirname(aFile);
  const projectName = basename(aFile).replace(/\.[^.]*$/, '');
  Pgm()
    .GetSettingsManager()
    .LoadProject(join(dir, `${projectName}.kicad_pro`), null);

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

  return new SCH_IO_KICAD_SEXPR('eeschema').SaveSchematicFile(
    schematic.GetTopLevelSheet()!,
    schematic,
  );
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
    if (/^\t\(/.test(ln)) {
      if (cur) items.push(cur.join('\n'));
      cur = [ln];
    } else if (cur) cur.push(ln);
  }
  if (cur) items.push(cur.join('\n'));
  return items.sort();
}

export { SCH_FILE_T };
