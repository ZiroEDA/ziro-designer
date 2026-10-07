// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Counterpart: `eeschema/files-io.cpp`, the parts of it that are decisions
 * rather than disk access.
 *
 * A `.ts` module rather than part of the editor component because `qa`'s
 * tsconfig has no `--jsx` and cannot import a `.tsx` at all — a rule only the
 * component knows is untestable by construction.
 */
import { IMPORT_PROJ_PROPS } from '@ziroeda/common/import_proj_properties.js';
import type { Reporter } from '@ziroeda/common/reporter.js';
import {
  SCH_FOOTPRINT_FIELD_RECONCILER,
  type SCH_FP_FIELD_RECONCILE_RESULT,
} from './sch_footprint_field_reconciler.js';
import { KICTL_CREATE } from '@ziroeda/common/kiway_player.js';
import type { JsonValue } from '@ziroeda/common/settings/json_settings_internals.js';
import { Pgm } from '@ziroeda/common/pgm_base.js';
import { niluuid } from '@ziroeda/common/kiid.js';
import { SCH_NAVIGATE_TOOL } from './tools/sch_navigate_tool.js';
import { SCH_COMMIT } from './sch_commit.js';
import type { SCH_EDIT_FRAME } from './sch_edit_frame.js';
import {
  PosixPath,
  SCH_IO_KICAD_SEXPR,
  type SCH_FILE_READER,
} from './sch_io/kicad_sexpr/sch_io_kicad_sexpr.js';
import { SCH_SCREENS } from './sch_screen.js';
import type { SCH_SHEET } from './sch_sheet.js';
import { SCH_CLEANUP_FLAGS, SCHEMATIC } from './schematic.js';

/**
 * `SCH_EDIT_FRAME::saveSchematicFile`'s success message
 * (eeschema/files-io.cpp:1073-1075):
 *
 *     msg.Printf( _( "File '%s' saved." ), screen->GetFileName() );
 *     SetStatusText( msg, 0 );
 *
 * The straight quotes are upstream's own — `_( "File '%s' saved." )` — not the
 * typographic pair, so a user comparing the two status bars sees the same
 * characters.
 *
 * Note WHICH name it interpolates: `screen->GetFileName()`. After
 * `Save Current Sheet Copy As...` that is still the ORIGINAL file, because
 * `saveSchematicFile` never calls `screen->SetFileName()` — see the comment on
 * `saveCurrSheetCopyAs` for why that is mirrored rather than corrected.
 */
export function savedFileMessage(filename: string): string {
  return `File '${filename}' saved.`;
}

/**
 * `SCH_EDIT_FRAME::OpenProjectFiles` (eeschema/files-io.cpp:451-458), raised
 * through `DisplayInfoMessage` when the parser fixed something or
 * `RepairPageNumbers` reassigned a blank or duplicated page:
 *
 *     DisplayInfoMessage( this,
 *                         _( "An error was found when loading the schematic that has "
 *                            "been automatically fixed.  Please save the schematic to "
 *                            "repair the broken file or it may not be usable with other "
 *                            "versions of KiCad." ) );
 *
 * The two spaces after "fixed." are upstream's.
 */
export const LOAD_REPAIRED_MESSAGE =
  'An error was found when loading the schematic that has been automatically fixed.  ' +
  'Please save the schematic to repair the broken file or it may not be usable with other ' +
  'versions of KiCad.';

/**
 * `SCH_EDITOR_CONTROL::Revert`'s question
 * (eeschema/tools/sch_editor_control.cpp:466-467):
 *
 *     msg.Printf( _( "Revert '%s' (and all sub-sheets) to last version saved?" ),
 *                 schematic.GetFileName() );
 *
 * The `%s` is `SCHEMATIC::GetFileName()` — the FIRST TOP-LEVEL SHEET's file
 * (eeschema/schematic.cpp:524-532) — not whichever sheet is on screen. The
 * parenthesis is why: it discards the whole hierarchy, so it names the project
 * rather than the sheet you happen to be looking at.
 */
export function revertPromptMessage(rootFileName: string): string {
  return `Revert '${rootFileName}' (and all sub-sheets) to last version saved?`;
}

/**
 * `IsOK`'s caption (common/confirm.cpp:293) — `KICAD_MESSAGE_DIALOG( aParent,
 * aMessage, _( "Confirmation" ), … )`. Not the frame's name, and not a question
 * of its own: every IsOK in KiCad puts this one word in the title bar.
 */
export const CONFIRMATION_CAPTION = 'Confirmation';

/**
 * `SCH_EDIT_FRAME::importFile`'s non-KiCad arm, once `LoadSchematicFile` has
 * produced the top-level sheet (files-io.cpp:1571-1581): "re-link footprint
 * fields to the project lib so update-from-schematic works" — the cache
 * nickname and source libraries the project import manager put in the
 * properties, handed to `SCH_FOOTPRINT_FIELD_RECONCILER`.
 *
 * Its caller is the import arm itself, which runs only for an Altium, CADSTAR,
 * Eagle, LTspice, EasyEDA, EasyEDA Pro, PADS or gEDA schematic; none of those
 * `SCH_IO` plugins is ported yet, so nothing calls this in the app until one is.
 */
export function ReconcileImportedFootprintFields(
  aSchematic: SCHEMATIC,
  aProperties: ReadonlyMap<string, string> | null,
  aLoadReporter: Reporter | null,
): SCH_FP_FIELD_RECONCILE_RESULT {
  const { cacheNickname, sourceFpLibs } = IMPORT_PROJ_PROPS.ReadFootprintProps(aProperties);

  const fpReconciler = new SCH_FOOTPRINT_FIELD_RECONCILER(
    cacheNickname,
    sourceFpLibs,
    aLoadReporter,
  );
  return fpReconciler.Reconcile(aSchematic);
}

/**
 * `SCH_EDIT_FRAME`'s half of `files-io.cpp`, on the live model: `OpenProjectFiles`'s load of
 * a KiCad s-expression schematic, step for step (files-io.cpp:98-790). A TypeScript class
 * cannot be split across files the way the C++ class is, so this is mixed into
 * `SCH_EDIT_FRAME` by `sch_edit_frame.ts` with `applyMixins`, as `schematic_undo_redo.ts` is.
 *
 * Left to the window, being UI or the desktop: the lock file and its override prompt,
 * `AskToSaveChanges`, the "does not exist, create it?" question (asked as `aCtl`'s
 * `KICTL_CREATE`), the progress reporter, the info bar, autosave recovery, the window state,
 * saving the outgoing project's local settings, and `DIALOG_MIGRATE_BUSES`. Not on the live model
 * yet: the legacy (`.sch`) plugin, `MigrateSimModels` (the simulator) and
 * `LoadProjectSettings`/`LoadDrawingSheet` (the window loads both from the record model).
 */
export class SCH_FILES_IO_MIXIN {
  /**
   * Load \a aFileSet's one schematic (with its hierarchy, or the project file's top-level
   * sheets) into a new SCHEMATIC on this frame. \a aReadFile answers a file's text by
   * absolute path (null: no such file). Returns false when it could not be loaded.
   */
  OpenProjectFiles(
    this: SCH_EDIT_FRAME,
    aFileSet: readonly string[],
    aCtl: number,
    aReadFile: SCH_FILE_READER,
  ): boolean {
    // This is for python:
    if (aFileSet.length !== 1) return false;

    const fullFileName = aFileSet[0]!;
    const is_new = aReadFile(fullFileName) === null;

    // "Schematic '%s' does not exist.  Do you wish to create it?" - the window asks.
    if (is_new && !(aCtl & KICTL_CREATE)) return false;

    this.ClearUndoRedoList();
    this.ClearRepeatItemsList();

    // The schematic's own project: the `.kicad_pro` beside it (files-io.cpp:186-206). Saving
    // the outgoing project's local settings is the window's (it persists the files).
    const pro = fullFileName.replace(/\.[^./]*$/, '.kicad_pro');
    const manager = Pgm().GetSettingsManager();

    if (pro !== this.Prj().GetProjectFullName()) {
      const json = (aPath: string): JsonValue | null => {
        const text = aReadFile(aPath);
        if (text === null) return null;
        try {
          return JSON.parse(text) as JsonValue;
        } catch {
          return null;
        }
      };

      if (!this.Prj().IsNullProject()) manager.UnloadProject(this.Prj());

      manager.LoadProject(pro, json(pro), json(pro.replace(/\.kicad_pro$/, '.kicad_prl')));

      const legacyPro = pro.replace(/\.kicad_pro$/, '.pro');

      if (aReadFile(pro) === null && aReadFile(legacyPro) === null && !(aCtl & KICTL_CREATE))
        this.Prj().SetReadOnly();
    }

    const newSchematic = new SCHEMATIC(this.Prj());

    if (is_new) {
      newSchematic.CreateDefaultScreens();
      this.SetSchematic(newSchematic);

      // mark new, unsaved file as modified.
      this.GetScreen()!.SetContentModified();
      this.GetScreen()!.SetFileName(fullFileName);
    } else {
      const pi = new SCH_IO_KICAD_SEXPR('eeschema');
      const projectPath = this.Prj().GetProjectPath();
      let failedLoad = false;

      try {
        // Check if project file has top-level sheets defined
        const topLevelSheets = this.Prj().GetProjectFile().GetTopLevelSheets();

        if (topLevelSheets.length > 0) {
          const loadedSheets: SCH_SHEET[] = [];

          // Load each top-level sheet
          for (const sheetInfo of topLevelSheets) {
            // wxFileName( Prj().GetProjectPath(), sheetInfo.filename ).GetFullPath()
            const sheetPath = PosixPath.makeAbsolute(sheetInfo.filename, projectPath);

            // "Top-level sheet file not found: %s" (a log warning upstream)
            if (aReadFile(sheetPath) === null) continue;

            const sheet = pi.LoadSchematicFile(sheetPath, newSchematic, projectPath, aReadFile);

            if (sheet) {
              // Preserve the UUID from the project file, unless it's niluuid which is
              // just a placeholder meaning "use the UUID from the file"
              if (sheetInfo.uuid !== niluuid) (sheet as { m_Uuid: string }).m_Uuid = sheetInfo.uuid;

              sheet.SetName(sheetInfo.name);
              loadedSheets.push(sheet);
            }
          }

          if (loadedSheets.length > 0) newSchematic.SetTopLevelSheets(loadedSheets);
          else newSchematic.CreateDefaultScreens();
        } else {
          // Legacy single-root format: Load the single root sheet
          const rootSheet = pi.LoadSchematicFile(
            fullFileName,
            newSchematic,
            projectPath,
            aReadFile,
          );

          if (rootSheet) {
            newSchematic.SetTopLevelSheets([rootSheet]);

            // Make ${SHEETNAME} work on the root sheet until we properly support
            // naming the root sheet
            newSchematic.GetTopLevelSheet()?.SetName('Root');
          } else {
            newSchematic.CreateDefaultScreens();
          }
        }
      } catch {
        // "Error loading schematic '%s'." - the window reports it.
        newSchematic.CreateDefaultScreens();
        failedLoad = true;
      }

      this.SetSchematic(newSchematic);

      if (failedLoad) {
        // Do not leave g_RootSheet == NULL because it is expected to be
        // a valid sheet. Therefore create a dummy empty root sheet and screen.
        this.Schematic().CreateDefaultScreens();
        return false;
      }

      const sheetList = this.Schematic().Hierarchy();

      if (sheetList.AllSheetPageNumbersEmpty()) sheetList.SetInitialPageNumbers();
      else sheetList.RepairPageNumbers();

      const schematic = new SCH_SCREENS(this.Schematic().Root());

      // S-expression schematic.
      for (let screen = schematic.GetFirst(); screen; screen = schematic.GetNext())
        screen.UpdateLocalLibSymbolLinks();

      const rootScreen = this.Schematic().RootScreen();

      if (rootScreen && rootScreen.GetFileFormatVersionAtLoad() < 20221002)
        sheetList.UpdateSymbolInstanceData(rootScreen.GetSymbolInstances());

      if (rootScreen && rootScreen.GetFileFormatVersionAtLoad() < 20221110)
        sheetList.UpdateSheetInstanceData(rootScreen.GetSheetInstances());

      if (rootScreen && rootScreen.GetFileFormatVersionAtLoad() < 20230221)
        for (let screen = schematic.GetFirst(); screen; screen = schematic.GetNext())
          screen.FixLegacyPowerSymbolMismatches();

      this.Schematic().LoadVariants();
      this.UpdateVariantSelectionCtrl(this.Schematic().GetVariantNamesForUI());

      sheetList.CheckForMissingSymbolInstances(this.Prj().GetProjectName());
      schematic.PruneOrphanedSymbolInstances(this.Prj().GetProjectName(), sheetList);
      schematic.PruneOrphanedSheetInstances(this.Prj().GetProjectName(), sheetList);

      this.Schematic().ConnectionGraph().Reset();

      const dummy = new SCH_COMMIT(this);
      this.RecalculateConnections(dummy, SCH_CLEANUP_FLAGS.GLOBAL_CLEANUP);
    }

    this.Schematic().ResolveERCExclusionsPostUpdate();

    this.initScreenZoom();
    this.SetSheetNumberAndCount();
    this.RecomputeIntersheetRefs();
    this.GetCurrentSheet().UpdateAllScreenReferences();

    // Ensure all items are redrawn (especially the drawing-sheet items):
    this.GetCanvas()?.DisplaySheet(this.GetCurrentSheet().LastScreen());

    // updateTitle() is the window's
    this.GetToolManager()?.GetTool(SCH_NAVIGATE_TOOL)?.ResetHistory();

    return true;
  }
}
