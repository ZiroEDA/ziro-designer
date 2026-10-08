// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sheet.cpp`: `SCH_EDIT_FRAME`'s sheet operations. The record model's `InitSheet`
 * (the window's), then the live model's (SCH_SHEET_MIXIN at the end): InitSheet,
 * CheckSheetForRecursion, ChangeSheetFile and AllowCaseSensitiveFileNameClashes.
 */
import { ExpandTextVars } from '@ziroeda/common/common.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { currentEeschemaSettings, type EeschemaSettings } from './eeschema_settings.js';
import type { SCH_EDIT_FRAME } from './sch_edit_frame.js';
import { SCH_SCREEN, SCH_SCREENS } from './sch_screen.js';
import { DisplayErrorMessage, DisplayInfoMessage } from '@ziroeda/common/confirm.js';
import { LIBRARY_TABLE, LIBRARY_TABLE_SCOPE } from '@ziroeda/common/libraries/library_table.js';
import { Pgm } from '@ziroeda/common/pgm_base.js';
import { SymbolLibAdapter } from './project_sch.js';
import {
  wxCANCEL,
  wxCANCEL_DEFAULT,
  wxCENTER,
  wxICON_ERROR,
  wxICON_QUESTION,
  wxOK,
} from '@ziroeda/common/wx/defs.js';
import { wxReadFileSync } from '@ziroeda/common/wx/filefn.js';
import { wxID_CANCEL } from '@ziroeda/common/wx/menu.js';
import { PosixPath, SCH_IO_KICAD_SEXPR } from './sch_io/kicad_sexpr/sch_io_kicad_sexpr.js';
import { SCH_SHEET } from './sch_sheet.js';
import { SCH_SHEET_LIST, type SCH_SHEET_PATH } from './sch_sheet_path.js';
import { SCH_CLEANUP_FLAGS } from './schematic.js';
import type { Schematic } from './types.js';

/**
 * `SCH_EDIT_FRAME::InitSheet`'s new screen for a freshly drawn sheet:
 *
 *     SCH_SCREEN* newScreen = new SCH_SCREEN( &Schematic() );
 *     aSheet->SetScreen( newScreen );
 *     aSheet->GetScreen()->SetContentModified();
 *     aSheet->GetScreen()->SetFileName( aNewFilename );
 *
 * `blank` is the empty screen already named `aNewFilename`. Only what the
 * "Export to other sheets" ticks ask for follows the parent:
 *
 *     if( cfg->m_PageSettings.export_paper )
 *         newScreen->SetPageSettings( GetScreen()->GetPageSettings() );
 *     if( cfg->m_PageSettings.export_title )
 *         tb2.SetTitle( tb1.GetTitle() );
 *
 * Every one of those defaults to false, so out of the box a new sheet gets its
 * own empty title block, exactly as upstream does.
 */
export function InitSheet(
  blank: Schematic,
  parent: Schematic | undefined,
  ex: EeschemaSettings['page_settings'],
): Schematic {
  const tb = parent?.titleBlock;
  return {
    ...blank,
    ...(ex.export_paper && parent?.paper ? { paper: parent.paper } : {}),
    ...(tb && blank.titleBlock
      ? {
          titleBlock: {
            ...blank.titleBlock,
            ...(ex.export_title && tb.title ? { title: tb.title } : {}),
            ...(ex.export_date && tb.date ? { date: tb.date } : {}),
            ...(ex.export_revision && tb.rev ? { rev: tb.rev } : {}),
            ...(ex.export_company && tb.company ? { company: tb.company } : {}),
          },
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// `SCH_EDIT_FRAME`'s sheet operations on the live model (sheet.cpp), as a mixin like
// annotate.ts's. Everything above is the record model's InitSheet, which the window still uses.
//
// Not here yet: LoadSheetFromFile (linking a file that is not already in the hierarchy; it
// reads a file from disk and remaps its libraries), EditSheetProperties (the dialog) and
// DrawCurrentSheetToClipboard.
// ---------------------------------------------------------------------------

/** `wxFileName::Normalize` against a directory: an absolute path, `.` and `..` resolved. */
function normalizeAgainst(aPath: string, aDir: string): string {
  const joined = aPath.startsWith('/') ? aPath : `${aDir}/${aPath}`;
  const out: string[] = [];
  for (const part of joined.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return `/${out.join('/')}`;
}

const dirOf = (aPath: string) => aPath.replace(/\/[^/]*$/, '') || '/';

/** The `KICAD_MESSAGE_DIALOG` "Continue Load Schematic" questions, which the window shows. */
export interface LOAD_SHEET_QUESTION_ARG {
  message: string;
  caption: string;
  style: number;
  extended?: string;
  okLabel?: string;
  cancelLabel?: string;
}

export class SCH_SHEET_MIXIN {
  /** `checkForNoFullyDefinedLibIds( aSheet )` (sheet.cpp:96). */
  checkForNoFullyDefinedLibIds(this: SCH_EDIT_FRAME, aSheet: SCH_SHEET): boolean {
    console.assert(!!aSheet.GetScreen());

    const newScreens = new SCH_SCREENS(aSheet);

    if (newScreens.HasNoFullyDefinedLibIds()) {
      const msg =
        `The schematic '${aSheet.GetScreen()!.GetFileName()}' has not had its symbol library links ` +
        'remapped to the symbol library table.  The project this schematic belongs to must first be ' +
        'remapped before it can be imported into the current project.';
      void DisplayInfoMessage(msg);
      return true;
    }

    return false;
  }

  /**
   * `LoadSheetFromFile( aSheet, aCurrentSheet, aFileName, aSkipRecursionCheck, aSkipLibCheck )`
   * (sheet.cpp:412): load a schematic file into \a aSheet (or append it to the sheet's screen),
   * from the mounted file system. The "Continue Load Schematic" questions are the window's.
   */
  async LoadSheetFromFile(
    this: SCH_EDIT_FRAME,
    aSheet: SCH_SHEET,
    aCurrentSheet: SCH_SHEET_PATH,
    aFileName: string,
    aSkipRecursionCheck = false,
    aSkipLibCheck = false,
  ): Promise<boolean> {
    let msg: string;
    let libTableChanged = false;

    // SCH_IO_MGR::GuessPluginTypeFromSchPath: the KiCad plugin is the one ported.
    const pi = new SCH_IO_KICAD_SEXPR();
    let tmpSheet = new SCH_SHEET(this.Schematic());

    // This will cause the sheet UUID to be set to the UUID of the aSheet argument.  This is
    // required to ensure all of the sheet paths in any sub-sheets are correctly generated when
    // using the temporary SCH_SHEET object that the file is loaded into..
    (tmpSheet as { m_Uuid: string }).m_Uuid = aSheet.m_Uuid;

    const projectPath = this.Prj().GetProjectPath();
    const fullFilename = PosixPath.makeAbsolute(aFileName, projectPath);
    const readFile = (aPath: string) => {
      const bytes = wxReadFileSync(aPath);
      return bytes ? new TextDecoder().decode(bytes) : null;
    };

    const ask = (aArg: LOAD_SHEET_QUESTION_ARG) =>
      this.ShowModalDialog('KICAD_MESSAGE_DIALOG', [], aArg);

    try {
      if (aSheet.GetScreen() !== null) {
        tmpSheet = pi.LoadSchematicFile(fullFilename, this.Schematic(), projectPath, readFile);
      } else {
        tmpSheet.SetFileName(fullFilename);
        pi.LoadSchematicFile(fullFilename, this.Schematic(), projectPath, readFile, tmpSheet);
      }

      if (pi.GetError() !== '') {
        msg =
          'The entire schematic could not be loaded.  Errors occurred attempting to load ' +
          'hierarchical sheet schematics.';

        const answer = await ask({
          message: msg,
          caption: 'Schematic Load Error',
          style: wxOK | wxCANCEL | wxCANCEL_DEFAULT | wxCENTER | wxICON_QUESTION,
          okLabel: 'Use partial schematic',
          extended: pi.GetError(),
        });

        if (answer === wxID_CANCEL) return false;
      }
    } catch (ioe) {
      msg = `Error loading schematic '${fullFilename}'.`;
      DisplayErrorMessage(msg, ioe instanceof Error ? ioe.message : String(ioe));

      msg = `Failed to load '${fullFilename}'.`;
      this.SetMsgPanel('', msg);

      return false;
    }

    // If the loaded schematic is in a different folder from the current project and
    // it contains hierarchical sheets, the hierarchical sheet paths need to be updated.
    //
    // Additionally, we need to make all backing screens absolute paths be in the current project
    // path not the source path.
    const loadedDir = PosixPath.dirname(fullFilename);

    if (`${loadedDir}/` !== `${projectPath.replace(/\/+$/, '')}/`) {
      const loadedSheets = SCH_SHEET_LIST.build(tmpSheet);

      for (const sheetPath of loadedSheets) {
        // Skip the loaded sheet since the user already determined if the file path should
        // be relative or absolute.
        if (sheetPath.size() === 1) continue;

        let lastSheetPath = projectPath;

        for (let i = 1; i < sheetPath.size(); i++) {
          const sheet = sheetPath.at(i);

          if (!sheet) continue; // wxCHECK2

          const screen = sheet.GetScreen();

          if (!screen) continue; // wxCHECK2

          // Use the screen file name which should always be absolute.
          const loadedSheetFileName = screen.GetFileName();

          if (!PosixPath.isAbsolute(loadedSheetFileName)) continue; // wxCHECK2

          const rel = PosixPath.makeRelativeTo(loadedSheetFileName, lastSheetPath);
          const sheetFileName = rel !== loadedSheetFileName ? rel : loadedSheetFileName;

          sheet.SetFileName(sheetFileName.replace(/\\/g, '/'));
          lastSheetPath = PosixPath.dirname(loadedSheetFileName);
        }
      }
    }

    const adapter = SymbolLibAdapter(this.Prj());
    const projectTable = adapter.ProjectTable();

    const loadedSheets = SCH_SHEET_LIST.build(tmpSheet);
    this.Schematic().RefreshHierarchy();
    const schematicSheets = this.Schematic().Hierarchy();

    // Make sure any new sheet changes do not cause any recursion issues.
    if (!aSkipRecursionCheck && this.CheckSheetForRecursion(tmpSheet, aCurrentSheet)) return false;

    if (this.checkForNoFullyDefinedLibIds(tmpSheet)) return false;

    // Make a valiant attempt to warn the user of all possible scenarios where there could
    // be broken symbol library links.
    const names: string[] = [];
    const newLibNames: string[] = [];
    const newScreens = new SCH_SCREENS(tmpSheet); // All screens associated with the import.
    const prjScreens = new SCH_SCREENS(this.Schematic().Root());

    newScreens.GetLibNicknames(names);

    const okButtonLabel = 'Continue Load';
    const cancelButtonLabel = 'Cancel Load';
    const question = wxOK | wxCANCEL | wxCANCEL_DEFAULT | wxCENTER | wxICON_QUESTION;

    // Prior to schematic file format 20221002, all symbol instance data was saved in the root
    // sheet so loading a hierarchical sheet that is not the root sheet will have no symbol
    // instance data.  Give the user a chance to go back and save the project that contains this
    // hierarchical sheet so the symbol instance data will be correct on load.
    if (
      tmpSheet.GetScreen()!.GetFileFormatVersionAtLoad() < 20221002 &&
      tmpSheet.GetScreen()!.GetSymbolInstances().length === 0
    ) {
      msg =
        'There are hierarchical sheets in the loaded schematic file from an older file version ' +
        'resulting in  missing symbol instance data.  This will result in all of the symbols in the ' +
        'loaded schematic to use either the default instance setting or fall back to the library ' +
        'symbol settings.  Loading the project that uses this schematic file and saving to the ' +
        'latest file version will resolve this issue.\n\nDo you wish to continue?';

      if (
        (await ask({
          message: msg,
          caption: 'Continue Load Schematic',
          style: question,
          okLabel: okButtonLabel,
          cancelLabel: cancelButtonLabel,
        })) === wxID_CANCEL
      )
        return false;
    }

    if (!aSkipLibCheck && !prjScreens.HasSchematic(fullFilename)) {
      if (`${loadedDir}/` === `${projectPath.replace(/\/+$/, '')}/`) {
        // A schematic in the current project path that isn't part of the current project.
        // It's possible the user copied this schematic from another project so the library
        // links may not be available.  Even this is check is no guarantee that all symbol
        // library links are valid but it's better than nothing.
        for (const name of names) {
          if (!SymbolLibAdapter(this.Prj()).HasLibrary(name)) newLibNames.push(name);
        }

        if (newLibNames.length > 0) {
          msg =
            'There are library names in the selected schematic that are missing from the current ' +
            'project library table.  This may result in broken symbol library references for the ' +
            'loaded schematic.\n\nDo you wish to continue?';

          if (
            (await ask({
              message: msg,
              caption: 'Continue Load Schematic',
              style: question,
              okLabel: okButtonLabel,
              cancelLabel: cancelButtonLabel,
            })) === wxID_CANCEL
          )
            return false;
        }
      } else if (projectTable) {
        // A schematic loaded from a path other than the current project path.

        // If there are symbol libraries in the imported schematic that are not in the
        // symbol library table of this project, there could be a lot of broken symbol
        // library links.  Attempt to add the missing libraries to the project symbol
        // library table.
        const duplicateLibNames: string[] = [];

        for (const name of names) {
          if (!SymbolLibAdapter(this.Prj()).HasLibrary(name)) newLibNames.push(name);
          else duplicateLibNames.push(name);
        }

        const symLibTableFn = `${loadedDir}/sym-lib-table`;
        const tableText = readFile(symLibTableFn);
        const table = new LIBRARY_TABLE(false, tableText, LIBRARY_TABLE_SCOPE.PROJECT);

        // If there are any new or duplicate libraries, check to see if it's possible that
        // there could be any missing libraries that would cause broken symbol library links.
        if (newLibNames.length > 0 || duplicateLibNames.length > 0) {
          if (tableText === null) {
            msg =
              'The selected file was created as part of a different project.  Linking the file to ' +
              'this project may result in missing or incorrect symbol library references.\n\n' +
              'Do you wish to continue?';

            if (
              (await ask({
                message: msg,
                caption: 'Continue Load Schematic',
                style: question,
                okLabel: okButtonLabel,
                cancelLabel: cancelButtonLabel,
              })) === wxID_CANCEL
            )
              return false;
          } else if (!table.IsOk()) {
            msg = `Error loading the symbol library table '${symLibTableFn}'.`;
            DisplayErrorMessage(msg, table.ErrorDescription());
            return false;
          }
        }

        // Check to see if any of the symbol libraries found in the appended schematic do
        // not exist in the current project are missing from the appended project symbol
        // library table.
        if (newLibNames.length > 0) {
          let missingLibNames = table.Rows().length === 0;

          if (!missingLibNames) {
            for (const newLibName of newLibNames) {
              if (!table.HasRow(newLibName)) {
                missingLibNames = true;
                break;
              }
            }
          }

          if (missingLibNames) {
            msg =
              'There are symbol library names in the selected schematic that are missing from the ' +
              'selected schematic project library table.  This may result in broken symbol library ' +
              'references.\n\nDo you wish to continue?';

            if (
              (await ask({
                message: msg,
                caption: 'Continue Load Schematic',
                style: question,
                okLabel: okButtonLabel,
                cancelLabel: cancelButtonLabel,
              })) === wxID_CANCEL
            )
              return false;
          }
        }

        const mgr = Pgm().GetLibraryManager();

        // The library name already exists in the current project.  Check to see if the
        // duplicate name is the same library in the current project.  If it's not, it's
        // most likely that the symbol library links will be broken.
        if (duplicateLibNames.length > 0 && table.Rows().length > 0) {
          let libNameConflict = false;

          for (const duplicateLibName of duplicateLibNames) {
            const thisRow = adapter.HasLibrary(duplicateLibName)
              ? adapter.GetRow(duplicateLibName)
              : null;
            const otherRow = table.HasRow(duplicateLibName)
              ? (table.Row(duplicateLibName) ?? null)
              : null;

            // It's in the global library table so there is no conflict.
            if (thisRow && !otherRow) continue;

            if (!thisRow || !otherRow) continue;

            const thisURI = mgr.GetFullURI(thisRow, true);
            let otherURI = mgr.GetFullURI(otherRow, false);

            if (otherURI.includes('${KIPRJMOD}') || otherURI.includes('$(KIPRJMOD)')) {
              // Cannot use relative paths here, "${KIPRJMOD}../path-to-cache-lib" does
              // not expand to a valid symbol library path.
              otherURI = `${loadedDir}/${otherURI.slice(otherURI.lastIndexOf('}') + 1).replace(/^\/+/, '')}`;
            }

            if (thisURI !== otherURI) {
              libNameConflict = true;
              break;
            }
          }

          if (libNameConflict) {
            msg =
              'A duplicate library name that references a different library exists in the current ' +
              'library table.  This conflict cannot be resolved and may result in broken symbol ' +
              'library references.\n\nDo you wish to continue?';

            if (
              (await ask({
                message: msg,
                caption: 'Continue Load Schematic',
                style: question,
                okLabel: okButtonLabel,
                cancelLabel: cancelButtonLabel,
              })) === wxID_CANCEL
            )
              return false;
          }
        }

        // All (most?) of the possible broken symbol library link cases are covered.  Map the
        // new appended schematic project symbol library table entries to the current project
        // symbol library table.
        if (newLibNames.length > 0 && table.Rows().length > 0) {
          for (const libName of newLibNames) {
            if (!table.HasRow(libName) || adapter.HasLibrary(libName)) continue;

            const row = table.Row(libName)!;

            // Don't expand environment variable because KIPRJMOD will not be correct
            // for a different project.
            let uri = mgr.GetFullURI(row, false);

            if (uri.includes('${KIPRJMOD}') || uri.includes('$(KIPRJMOD)')) {
              // Cannot use relative paths here, "${KIPRJMOD}../path-to-cache-lib" does
              // not expand to a valid symbol library path.
              uri = `${loadedDir}/${uri.slice(uri.lastIndexOf('}') + 1).replace(/^\/+/, '')}`;
            } else {
              uri = mgr.GetFullURI(row, true);
            }

            // Add the library from the imported project to the current project
            // symbol library table.
            const newRow = projectTable.InsertRow();

            newRow.SetNickname(libName);
            newRow.SetURI(uri);
            newRow.SetType(row.Type());
            newRow.SetDescription(row.Description());
            newRow.SetOptions(row.Options());

            libTableChanged = true;
          }
        }
      }
    }

    const newScreen = tmpSheet.GetScreen();

    if (!newScreen) return false; // wxCHECK_MSG: "No screen defined for sheet."

    if (libTableChanged && projectTable) {
      const saved = projectTable.Save();

      if (!saved.ok)
        await this.ShowModalDialog('KICAD_MESSAGE_DIALOG', [], {
          message: 'Error saving library table.',
          caption: 'File Save Error',
          style: wxOK | wxICON_ERROR,
          extended: saved.error.message,
        } satisfies LOAD_SHEET_QUESTION_ARG);
    }

    // Make the best attempt to set the symbol instance data for the loaded schematic.
    if (newScreen.GetFileFormatVersionAtLoad() < 20221002) {
      // If the loaded schematic is a root sheet for another project, update the symbol
      // instances.
      if (newScreen.GetSymbolInstances().length > 0)
        loadedSheets.UpdateSymbolInstanceData(newScreen.GetSymbolInstances());
    }

    // `newScreen->MigrateSimModels()`: the simulator's, which is not ported.

    // Attempt to create new symbol instances using the instance data loaded above.
    loadedSheets.AddNewSymbolInstances(aCurrentSheet, this.Prj().GetProjectName());

    // Add new sheet instance data.
    loadedSheets.AddNewSheetInstances(aCurrentSheet, schematicSheets.GetLastVirtualPageNumber());

    // It is finally safe to add or append the imported schematic.
    if (aSheet.GetScreen() === null) aSheet.SetScreen(newScreen);
    else aSheet.GetScreen()!.Append(newScreen);

    const allProjectScreens = new SCH_SCREENS(this.Schematic().Root());
    allProjectScreens.ReplaceDuplicateTimeStamps();

    return true;
  }

  /** `SCH_EDIT_FRAME::InitSheet` (sheet.cpp:118): a new, empty screen for a new sheet file. */
  InitSheet(this: SCH_EDIT_FRAME, aSheet: SCH_SHEET, aNewFilename: string): void {
    const newScreen = new SCH_SCREEN(this.Schematic());
    aSheet.SetScreen(newScreen);
    aSheet.GetScreen()!.SetContentModified();
    aSheet.GetScreen()!.SetFileName(aNewFilename);

    const cfg = currentEeschemaSettings().page_settings;
    const screen = this.GetScreen()!;

    if (cfg.export_paper) newScreen.SetPageSettings(screen.GetPageSettings());

    const tb1 = screen.GetTitleBlock();
    const tb2 = newScreen.GetTitleBlock().clone();

    if (cfg.export_revision) tb2.SetRevision(tb1.GetRevision());
    if (cfg.export_date) tb2.SetDate(tb1.GetDate());
    if (cfg.export_title) tb2.SetTitle(tb1.GetTitle());
    if (cfg.export_company) tb2.SetCompany(tb1.GetCompany());

    for (let i = 0; i < 9; i++) if (cfg.export_comments[i]) tb2.SetComment(i, tb1.GetComment(i));

    newScreen.SetTitleBlock(tb2);
  }

  /**
   * `SCH_EDIT_FRAME::CheckSheetForRecursion` (sheet.cpp:62): true (and an error shown) when
   * \a aSheet, or one of its subsheets, already has \a aCurrentSheet's file as a parent.
   */
  CheckSheetForRecursion(
    this: SCH_EDIT_FRAME,
    aSheet: SCH_SHEET,
    aCurrentSheet: SCH_SHEET_PATH,
  ): boolean {
    const schematicSheets = this.Schematic().Hierarchy();
    const loadedSheets = SCH_SHEET_LIST.build(aSheet); // This is the schematicSheets of the loaded file.

    const destFilePath = aCurrentSheet.LastScreen()!.GetFileName();

    // If file is unsaved then there can't (yet) be any recursion.
    if (destFilePath === '') return false;

    if (schematicSheets.TestForRecursion(loadedSheets, destFilePath)) {
      this.DisplayError(
        `The sheet changes cannot be made because the destination sheet already has the sheet ` +
          `'${destFilePath}' or one of its subsheets as a parent somewhere in the schematic hierarchy.`,
      );
      return true;
    }

    return false;
  }

  /**
   * `SCH_EDIT_FRAME::ChangeSheetFile` (sheet.cpp:177): point \a aSheet at \a aNewFilename. A new
   * sheet gets a new screen for a new file, or shares the screen of a file the hierarchy already
   * has (after the recursion check); an existing sheet is relinked or its contents saved under
   * the new name. Returns false when the change was refused or failed.
   */
  ChangeSheetFile(
    this: SCH_EDIT_FRAME,
    aSheet: SCH_SHEET,
    aNewFilename: string,
    aClearAnnotationNewItems: { value: boolean } | null = null,
    aIsUndoable: { value: boolean } | null = null,
  ): boolean {
    const schematic = this.Schematic();

    // Resolve text variables before touching disk. The field keeps the raw text for portability.
    const sheetFileName = ExpandTextVars(aNewFilename, (token) =>
      schematic.Project().TextVarResolver(token),
    );

    const currentScreen = this.GetCurrentSheet().LastScreen();

    if (!currentScreen) return false; // wxCHECK( currentScreen, false )

    // SCH_SCREEN file names are always absolute.
    const newAbsoluteFilename = normalizeAgainst(
      sheetFileName.replace(/\\/g, '/'),
      dirOf(currentScreen.GetFileName()),
    );

    if (!this.AllowCaseSensitiveFileNameClashes(aSheet.GetFileName(), newAbsoluteFilename))
      return false;

    const fullHierarchy = schematic.Hierarchy();
    let renameFile = false;
    let loadFromFile = false;
    let clearAnnotation = false;
    const useScreen = { value: null as SCH_SCREEN | null };

    // Search for a schematic file already in use in the hierarchy or on disk
    if (!schematic.Root().SearchHierarchy(newAbsoluteFilename, useScreen))
      loadFromFile = this.FileExists(newAbsoluteFilename);

    const shortName = newAbsoluteFilename.replace(/^.*\//, '');

    if (aSheet.GetScreen() === null) {
      // New sheet with no screen yet
      if (useScreen.value || loadFromFile) {
        clearAnnotation = true;

        if (
          !this.IsOK(
            `'${shortName}' already exists.\n\nLink '${newAbsoluteFilename}' to this file?`,
          )
        )
          return false;
      } else {
        this.InitSheet(aSheet, newAbsoluteFilename);
      }
    } else {
      // Existing sheet
      const oldAbsoluteFilename = aSheet.GetScreen()!.GetFileName().replace(/\\/g, '/');

      if (newAbsoluteFilename !== oldAbsoluteFilename) {
        // Sheet file name changes cannot be undone
        if (aIsUndoable) aIsUndoable.value = false;

        if (useScreen.value || loadFromFile) {
          clearAnnotation = true;

          if (
            !this.IsOK(
              `Change '${newAbsoluteFilename}' link from '${aSheet.GetFileName()}' to '${shortName}'?` +
                '\n\nThis action cannot be undone.',
            )
          )
            return false;

          if (loadFromFile) aSheet.SetScreen(null);
        } else {
          // Save current content to new file name
          if (
            aSheet.GetScreenCount() > 1 &&
            !this.IsOK(
              `Create new file '${shortName}' with contents of '${aSheet.GetFileName()}'?` +
                '\n\nThis action cannot be undone.',
            )
          )
            return false;

          renameFile = true;
        }
      }

      if (renameFile) {
        // Only update the screen filename when this is the sole user. The file itself is
        // written when the project is saved (pi->SaveSchematicFile upstream writes it now).
        if (aSheet.GetScreenCount() <= 1) aSheet.GetScreen()!.SetFileName(newAbsoluteFilename);
        else {
          // A shared screen is reloaded upstream from the file just written.
          this.DisplayError(
            `Splitting the shared sheet '${aSheet.GetFileName()}' is not supported yet.`,
          );
          return false;
        }
      }
    }

    const currentSheet = this.GetCurrentSheet();

    if (useScreen.value) {
      // Recursion test with a temporary sheet
      const tmpSheet = new SCH_SHEET(schematic);
      tmpSheet.GetField(FIELD_T.SHEET_FILENAME)!.SetText(sheetFileName);
      tmpSheet.SetScreen(useScreen.value);

      if (this.CheckSheetForRecursion(tmpSheet, currentSheet)) return false;

      aSheet.SetScreen(useScreen.value);

      const sheetHierarchy = SCH_SHEET_LIST.build(aSheet);
      sheetHierarchy.AddNewSymbolInstances(currentSheet, this.Prj().GetProjectName());
      sheetHierarchy.AddNewSheetInstances(currentSheet, fullHierarchy.GetLastVirtualPageNumber());
    } else if (loadFromFile) {
      // LoadSheetFromFile is not ported: a file outside the hierarchy cannot be linked yet.
      this.DisplayError(
        `Linking '${shortName}', a file not already in the hierarchy, is not supported yet.`,
      );
      return false;
    }

    if (aClearAnnotationNewItems) aClearAnnotationNewItems.value = clearAnnotation;

    this.RecalculateConnections(null, SCH_CLEANUP_FLAGS.GLOBAL_CLEANUP);

    const repairedList = SCH_SHEET_LIST.build(null);
    repairedList.BuildSheetList(schematic.Root(), true);

    return true;
  }

  /**
   * `SCH_EDIT_FRAME::AllowCaseSensitiveFileNameClashes` (sheet.cpp:967): a sheet file name that
   * differs only in case from one beside it in the hierarchy breaks the project on a
   * case-insensitive file system; asks before going on.
   */
  AllowCaseSensitiveFileNameClashes(
    this: SCH_EDIT_FRAME,
    aOldName: string,
    aSchematicFileName: string,
  ): boolean {
    const sheets = this.Schematic().Hierarchy();

    if (!aSchematicFileName.startsWith('/')) return false; // wxCHECK( fn.IsAbsolute(), false )

    const pathOf = (f: string) => f.replace(/\/[^/]*$/, '');
    const nameOf = (f: string) => f.replace(/^.*\//, '');

    const can_cause_issues = (): boolean => {
      const oldLower = nameOf(aOldName).toLowerCase();
      const rhsLower = nameOf(aSchematicFileName).toLowerCase();
      let count = 0;

      for (const sheet of sheets) {
        const lhs = sheet.LastScreen()!.GetFileName();

        if (pathOf(lhs) !== pathOf(aSchematicFileName)) continue;

        const lhsLower = nameOf(lhs).toLowerCase();

        if (lhsLower === rhsLower && nameOf(lhs) !== nameOf(aSchematicFileName)) count++;
      }

      // If we are renaming a sheet that is only used once, then we are not going to cause
      // a case sensitivity issue.
      if (oldLower === rhsLower) return count > 1;

      return count > 0;
    };

    if (
      currentEeschemaSettings().appearance.show_sheet_filename_case_sensitivity_dialog &&
      can_cause_issues()
    ) {
      const name = nameOf(aSchematicFileName).replace(/\.[^.]*$/, '');

      // wxRichMessageDialog with "Create New Sheet" / "Cancel" and a "Do not show this message
      // again" box: here a yes/no question.
      if (
        !this.IsOK(
          `The file name '${name}' can cause issues with an existing file name\n` +
            'already defined in the schematic on systems that support case\n' +
            'insensitive file names.  This will cause issues if you copy this\n' +
            'project to an operating system that supports case insensitive file\n' +
            'names.\n\nDo you wish to continue?',
        )
      )
        return false;
    }

    return true;
  }
}
