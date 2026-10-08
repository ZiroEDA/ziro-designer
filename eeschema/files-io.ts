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
import { ensureFileExtension } from '@ziroeda/common/common.js';
import { PROJECT_FILE_EXTENSION } from '@ziroeda/common/project/project_file.js';
import {
  KiCadSchematicFileExtension,
  kicadSchematicWildcard,
} from '@ziroeda/common/wildcards_and_files_ext.js';
import {
  wxCANCEL,
  wxCANCEL_DEFAULT,
  wxCENTER,
  wxFD_OVERWRITE_PROMPT,
  wxFD_SAVE,
  wxICON_EXCLAMATION,
  wxICON_WARNING,
  wxOK,
} from '@ziroeda/common/wx/defs.js';
import {
  wxDirExists,
  wxFileExists,
  wxIsDirWritable,
  wxMkdir,
  wxWriteFileSync,
} from '@ziroeda/common/wx/filefn.js';
import { wxID_CANCEL } from '@ziroeda/common/wx/menu.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SEXPR_SCHEMATIC_FILE_VERSION } from './sch_file_versions.js';
import type { JsonValue } from '@ziroeda/common/settings/json_settings_internals.js';
import { Pgm } from '@ziroeda/common/pgm_base.js';
import { niluuid } from '@ziroeda/common/kiid.js';
import type { SCH_NAVIGATE_TOOL } from './tools/sch_navigate_tool.js';
import { SCH_COMMIT } from './sch_commit.js';
import type { SCH_EDIT_FRAME } from './sch_edit_frame.js';
import {
  PosixPath,
  SCH_IO_KICAD_SEXPR,
  type SCH_FILE_READER,
} from './sch_io/kicad_sexpr/sch_io_kicad_sexpr.js';
import { type SCH_SCREEN, SCH_SCREENS } from './sch_screen.js';
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
/** `KICAD_MESSAGE_DIALOG` / `wxRichMessageDialog`, which the window shows. */
export interface SAVE_MESSAGE_DIALOG_ARG {
  message: string;
  caption: string;
  style: number;
  /** `SetExtendedMessage` / `ShowDetailedText`. */
  extended?: string;
  /** `SetOKCancelLabels`. */
  okLabel?: string;
  cancelLabel?: string;
}

/** `FILEDLG_HOOK_SAVE_PROJECT`'s three checkboxes, which the window fills when it shows them. */
export interface FILEDLG_HOOK_SAVE_PROJECT {
  attached: boolean;
  createNewProject: boolean;
  copySubsheets: boolean;
  includeExternSheets: boolean;
}

/**
 * `PrepareSaveAsFiles` (files-io.cpp:1086): where each sub-sheet goes on a Save As - moved with
 * the root, or into \a aFilenameMap for a copy. False, with \a aErrorMsg set, when a folder
 * could not be made.
 */
export function PrepareSaveAsFiles(
  aSchematic: SCHEMATIC,
  aScreens: SCH_SCREENS,
  aOldRoot: string,
  aNewRoot: string,
  aSaveCopy: boolean,
  aCopySubsheets: boolean,
  aIncludeExternSheets: boolean,
  aFilenameMap: Map<SCH_SCREEN, string>,
  aErrorMsg: { value: string },
): boolean {
  const oldRootPath = PosixPath.dirname(aOldRoot);
  const newRootPath = PosixPath.dirname(aNewRoot);

  for (let i = 0; i < aScreens.GetCount(); i++) {
    const screen = aScreens.GetScreen(i);

    if (!screen) continue; // wxCHECK2

    if (screen === aSchematic.RootScreen()) continue;

    let src = screen.GetFileName();

    if (!PosixPath.isAbsolute(src)) src = PosixPath.makeAbsolute(src, oldRootPath);

    const internalSheet = PosixPath.dirname(src).startsWith(oldRootPath);

    if (aCopySubsheets && (internalSheet || aIncludeExternSheets)) {
      const rel = PosixPath.makeRelativeTo(src, oldRootPath);
      const dest =
        internalSheet && rel !== src
          ? PosixPath.makeAbsolute(rel, newRootPath)
          : `${newRootPath}/${src.slice(src.lastIndexOf('/') + 1)}`;

      const destDir = PosixPath.dirname(dest);

      if (!wxDirExists(destDir) && !wxMkdir(destDir)) {
        aErrorMsg.value = `Folder '${destDir}' could not be created.\n\nMake sure you have write permissions and try again.`;
        return false;
      }

      if (aSaveCopy) aFilenameMap.set(screen, dest);
      else screen.SetFileName(dest);
    } else {
      if (aSaveCopy) aFilenameMap.set(screen, '');

      screen.SetFileName(src);
    }
  }

  for (const sheet of aSchematic.Hierarchy()) {
    if (!sheet.Last()!.IsTopLevelSheet()) sheet.MakeFilePathRelativeToParentSheet();
  }

  return true;
}

export class SCH_FILES_IO_MIXIN {
  /**
   * `saveSchematicFile( aSheet, aSavePath )` (files-io.cpp:991): write one sheet's screen to
   * \a aSavePath on the mounted file system.
   */
  saveSchematicFile(this: SCH_EDIT_FRAME, aSheet: SCH_SHEET, aSavePath: string): boolean {
    const screen = aSheet.GetScreen();

    if (!screen) return false; // wxCHECK

    // Cannot save to nowhere
    if (aSavePath === '') return false;

    // Construct the name of the file to be saved
    const schematicFileName = this.Prj().AbsolutePath(aSavePath);
    const dir = PosixPath.dirname(schematicFileName);

    if (!wxDirExists(dir)) {
      if (!wxMkdir(dir)) {
        this.DisplayError(
          `Error saving schematic file '${schematicFileName}'.\nCould not create directory: %s${dir}`,
        );

        return false;
      }
    }

    if (!this.IsWritable(schematicFileName)) return false;

    const projectFile = schematicFileName.replace(/\.[^./]*$/, `.${PROJECT_FILE_EXTENSION}`);

    // Save various ERC settings, such as violation severities (which may have been edited
    // via the ERC dialog as well as the Schematic Setup dialog), ERC exclusions, etc.
    if (wxFileExists(projectFile)) this.saveProjectSettings();

    // `m_infoBar->GetMessageType() == OUTDATED_SAVE`: this infobar keeps no message type.

    let success: boolean;

    try {
      const text = new SCH_IO_KICAD_SEXPR().SaveSchematicFile(aSheet, this.Schematic());

      success = wxWriteFileSync(schematicFileName, new TextEncoder().encode(text));

      if (!success) throw new Error('no writable mount covers the path');
    } catch (ioe) {
      this.DisplayError(
        `Error saving schematic file '${schematicFileName}'.\n${ioe instanceof Error ? ioe.message : String(ioe)}`,
      );

      success = false;
    }

    if (success) {
      screen.SetContentModified(false);

      this.SetStatusText(savedFileMessage(screen.GetFileName()), 0);
    }

    return success;
  }

  /**
   * `SaveProject( aSaveAs )` (files-io.cpp:1155). The file dialog and message boxes are the
   * window's, so this resolves when they are answered.
   */
  async SaveProject(this: SCH_EDIT_FRAME, aSaveAs = false): Promise<boolean> {
    let msg = '';
    const screens = new SCH_SCREENS(this.Schematic().Root());
    // `aSaveAs && !Kiface().IsSingle()`: the browser always runs under the project manager.
    const saveCopy = aSaveAs;
    let success = true;
    let createNewProject = false;
    let copySubsheets = false;
    let includeExternSheets = false;

    const fileName = this.Prj().AbsolutePath(this.Schematic().Root().GetFileName());

    // Path to save each screen to: will be the stored filename by default, but is overwritten
    // by a Save As Copy operation.
    const filenameMap = new Map<SCH_SCREEN, string>();

    // Handle "Save As" and saving a new project/schematic for the first time in standalone
    if (this.Prj().IsNullProject() || aSaveAs) {
      let savePath = this.Prj().GetProjectFullName();

      if (savePath === '' || !wxIsDirWritable(PosixPath.dirname(savePath)))
        savePath = this.Prj().GetProjectPath();

      savePath = savePath.replace(/\.[^./]*$/, `.${KiCadSchematicFileExtension}`);

      const newProjectHook: FILEDLG_HOOK_SAVE_PROJECT = {
        attached: true,
        createNewProject: false,
        copySubsheets: false,
        includeExternSheets: false,
      };

      const picked = await this.ShowFileDialog(
        'Schematic Files',
        PosixPath.dirname(savePath),
        savePath.slice(savePath.lastIndexOf('/') + 1),
        [kicadSchematicWildcard()],
        wxFD_SAVE | wxFD_OVERWRITE_PROMPT,
        newProjectHook,
      );

      if (picked === null) return false;

      const newFileName = ensureFileExtension(picked, KiCadSchematicFileExtension);
      const newDir = PosixPath.dirname(newFileName);

      if ((!wxDirExists(newDir) && !wxMkdir(newDir)) || !wxIsDirWritable(newDir)) {
        msg = `Folder '${newDir}' could not be created.\n\nMake sure you have write permissions and try again.`;

        await this.ShowModalDialog('KICAD_MESSAGE_DIALOG', [], {
          message: msg,
          caption: 'Error',
          style: wxOK | wxICON_EXCLAMATION | wxCENTER,
        } satisfies SAVE_MESSAGE_DIALOG_ARG);
        return false;
      }

      if (newProjectHook.attached) {
        createNewProject = newProjectHook.createNewProject;
        copySubsheets = newProjectHook.copySubsheets;
        includeExternSheets = newProjectHook.includeExternSheets;
      }

      if (!saveCopy) {
        this.Schematic()
          .Root()
          .SetFileName(newFileName.slice(newFileName.lastIndexOf('/') + 1));
        this.Schematic().RootScreen()!.SetFileName(newFileName);
      } else {
        filenameMap.set(this.Schematic().RootScreen()!, newFileName);
      }

      const err = { value: '' };

      if (
        !PrepareSaveAsFiles(
          this.Schematic(),
          screens,
          fileName,
          newFileName,
          saveCopy,
          copySubsheets,
          includeExternSheets,
          filenameMap,
          err,
        )
      ) {
        await this.ShowModalDialog('KICAD_MESSAGE_DIALOG', [], {
          message: err.value,
          caption: 'Error',
          style: wxOK | wxICON_EXCLAMATION | wxCENTER,
        } satisfies SAVE_MESSAGE_DIALOG_ARG);
        return false;
      }
    } else if (!wxFileExists(fileName)) {
      // File doesn't exist yet; true if we just imported something
    } else if (
      screens.GetFirst() &&
      screens.GetFirst()!.GetFileFormatVersionAtLoad() < SEXPR_SCHEMATIC_FILE_VERSION
    ) {
      // Allow the user to save un-edited files in new format
    } else if (!this.IsContentModified()) {
      return true;
    }

    if (filenameMap.size === 0 || !saveCopy) {
      for (let i = 0; i < screens.GetCount(); i++)
        filenameMap.set(screens.GetScreen(i)!, screens.GetScreen(i)!.GetFileName());
    }

    // Warn user on potential file overwrite.  This can happen on shared sheets.
    const overwrittenFiles: string[] = [];
    const lockedFiles: string[] = [];

    for (let i = 0; i < screens.GetCount(); i++) {
      const screen = screens.GetScreen(i);

      if (!screen) continue; // wxCHECK2

      // Convert legacy schematics file name extensions for the new format.
      const tmpFn = filenameMap.get(screen) ?? '';

      if (tmpFn === '') continue;

      if (wxFileExists(tmpFn) && !wxIsDirWritable(PosixPath.dirname(tmpFn)))
        lockedFiles.push(tmpFn);

      if (tmpFn.endsWith(`.${KiCadSchematicFileExtension}`)) continue;

      const converted = tmpFn.replace(/\.[^./]*$/, `.${KiCadSchematicFileExtension}`);

      if (wxFileExists(converted)) overwrittenFiles.push(converted);
    }

    if (lockedFiles.length > 0) {
      for (const lockedFile of lockedFiles) msg = msg === '' ? lockedFile : `${msg}\n${lockedFile}`;

      await this.ShowModalDialog('wxRichMessageDialog', [], {
        message: `Failed to save ${this.Schematic().Root().GetFileName()}.`,
        caption: 'Locked File Warning',
        style: wxOK | wxICON_WARNING | wxCENTER,
        extended: `You do not have write permissions to:\n\n${msg}`,
      } satisfies SAVE_MESSAGE_DIALOG_ARG);
      return false;
    }

    if (overwrittenFiles.length > 0) {
      for (const overwrittenFile of overwrittenFiles)
        msg = msg === '' ? overwrittenFile : `${msg}\n${overwrittenFile}`;

      const answer = await this.ShowModalDialog('wxRichMessageDialog', [], {
        message: 'Saving will overwrite existing files.',
        caption: 'Save Warning',
        style: wxOK | wxCANCEL | wxCANCEL_DEFAULT | wxCENTER | wxICON_EXCLAMATION,
        extended: `The following files will be overwritten:\n\n${msg}`,
        okLabel: 'Overwrite Files',
        cancelLabel: 'Abort Project Save',
      } satisfies SAVE_MESSAGE_DIALOG_ARG);

      if (answer === wxID_CANCEL) return false;
    }

    screens.BuildClientSheetPathList();

    for (let i = 0; i < screens.GetCount(); i++) {
      const screen = screens.GetScreen(i);

      if (!screen) continue; // wxCHECK2

      // Convert legacy schematics file name extensions for the new format.
      let tmpFn = filenameMap.get(screen) ?? '';

      if (tmpFn !== '' && !tmpFn.endsWith(`.${KiCadSchematicFileExtension}`)) {
        tmpFn = tmpFn.replace(/\.[^./]*$/, `.${KiCadSchematicFileExtension}`);

        for (const item of screen.Items().OfType(KICAD_T.SCH_SHEET_T)) {
          const sheet = item as SCH_SHEET;
          const sheetFileName = sheet.GetFileName();

          if (sheetFileName === '' || sheetFileName.endsWith(`.${KiCadSchematicFileExtension}`))
            continue;

          sheet.SetFileName(sheetFileName.replace(/\.[^./]*$/, `.${KiCadSchematicFileExtension}`));
          this.UpdateItem(sheet);
        }

        filenameMap.set(screen, tmpFn);

        if (!saveCopy) screen.SetFileName(tmpFn);
      }

      // Do not save sheet symbols with no valid filename set
      if (tmpFn === '') continue;

      const sheets = screen.GetClientSheetPaths();

      if (sheets.length === 1) screen.SetVirtualPageNumber(1);
      else screen.SetVirtualPageNumber(0); // multiple uses; no way to store the real sheet #

      // This is a new schematic file so make sure it has a unique ID.
      if (!saveCopy && tmpFn !== screen.GetFileName()) screen.AssignNewUuid();

      const savedThisSheet = this.saveSchematicFile(screens.GetSheet(i)!, tmpFn);

      success &&= savedThisSheet;
    }

    // m_autoSaveTimer / m_autoSavePending: the autosave is the window's.
    if (success) this.ClearAutoSaveRequired();

    // `LockFile( ... )` and `UpdateFileHistory( ... )` are the desktop's lock file and recent-file
    // list; the project store keeps neither.

    // Save the sheet name map to the project file
    const projectSheets = this.Prj().GetProjectFile().GetSheets();
    projectSheets.length = 0;

    for (const sheetPath of this.Schematic().Hierarchy()) {
      const sheet = sheetPath.Last();

      if (!sheet) continue; // wxCHECK2

      // Do not save the virtual root sheet
      if (!sheet.IsVirtualRootSheet())
        projectSheets.push({ first: sheet.m_Uuid, second: sheet.GetName() });
    }

    const rootFile = filenameMap.get(this.Schematic().RootScreen()!)!;
    const projectPath = rootFile.replace(/\.[^./]*$/, `.${PROJECT_FILE_EXTENSION}`);
    const manager = Pgm().GetSettingsManager();

    if (this.Prj().IsNullProject() || (aSaveAs && !saveCopy)) {
      this.Prj().SetReadOnly(!createNewProject);
      manager.SaveProjectAs(projectPath);
    } else if (saveCopy && createNewProject) {
      manager.SaveProjectCopy(projectPath);
    } else {
      this.SaveProjectLocalSettings();
      this.saveProjectSettings();
    }

    // `Kiway().LocalHistory()` snapshots and autosave-file cleanup, and `TriggerBackupIfNeeded`:
    // the desktop's local history and backups; the cloud store keeps the versions.

    // Restore the virtual page numbers that were modified during save.
    for (const sheet of this.Schematic().Hierarchy())
      sheet.LastScreen()!.SetVirtualPageNumber(sheet.GetVirtualPageNumber());

    this.SetSheetNumberAndCount();

    if (this.GetCanvas()?.GetView()) {
      this.GetCanvas()!.GetView().RefreshDrawingSheetPageInfo();
      this.GetCanvas()!.Refresh();
    }

    // updateTitle() is the window's

    return success;
  }

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
    // By name: importing the tool here would close an import cycle through SCH_EDIT_FRAME's mixins.
    (
      this.GetToolManager()?.FindTool('eeschema.NavigateTool') as SCH_NAVIGATE_TOOL | null
    )?.ResetHistory();

    return true;
  }
}
