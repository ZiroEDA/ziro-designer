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
import { SCH_SCREEN } from './sch_screen.js';
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

export class SCH_SHEET_MIXIN {
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
